import cv2
import numpy as np
import os
import time
import logging
import sys
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional, Tuple
from skimage.metrics import structural_similarity as compute_ssim

try:
    from ultralytics import YOLO
except ImportError:
    YOLO = None  # person-presence suppression will be disabled if ultralytics isn't installed

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("TamperDetector")

# Force RTSP over TCP -- far more resilient to WAN packet loss/jitter than
# the default, which often manifests as stalls that look like "no motion".
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

# ──────────────────────────────────────────────────────────────────────────
# SET THIS TO YOUR ACTUAL CAMERA. Both URLs seen in your testing are listed
# below as comments — uncomment / edit the one you actually use.
# ──────────────────────────────────────────────────────────────────────────
RTSP_URL = "rtsp://admin:admin@123@14.195.152.243:554/cam/realmonitor?channel=4&subtype=0&unicast=true&proto=Onvif"
# RTSP_URL = "rtsp://admin:admin123@192.168.0.63:554/stream1"

# NOTE: subtype=0 is Dahua's high-bitrate mainstream at full sensor
# resolution. Since analysis works on a 320x240 downscale anyway, pulling
# subtype=1 (the substream) is recommended for the analytics connection --
# it's far less likely to stall on a WAN link. Keep subtype=0 only if this
# same connection is also used for recording/live-view at full quality.

# ── Fast pixel checks ───────────────────────────────────────────────────────
BLUR_THRESHOLD          = 60.0
DARK_THRESHOLD          = 10.0
BRIGHT_THRESHOLD        = 238.0
UNIFORM_STD_THRESHOLD   = 6.0

# ── Architectural plausibility (primary signal, both reference-build
#    gate and runtime classification) ───────────────────────────────────────
ARCH_PRE_BLUR            = 5      # odd kernel size, suppresses noise before CLAHE
ARCH_CLAHE_CLIP          = 1.2    # conservative -- higher values manufacture
                                   # fake edges from noise on flat/cloth surfaces
ARCH_CLAHE_GRID          = (8, 8)
ARCH_CANNY_LO_MULT       = 0.66   # adaptive (median-based) Canny thresholds
ARCH_CANNY_HI_MULT       = 1.33   # auto-scale to whatever contrast exists
ARCH_HOUGH_VOTE          = 32
ARCH_HOUGH_MIN_LEN       = 40
ARCH_HOUGH_MAX_GAP       = 4
LINE_MIN_FOR_REAL_SCENE  = 6      # lowered from 8 -- real-room field testing
                                   # showed legitimate dips to 4-7 even on a
                                   # clearly real, well-lit room. Cloth/polythene
                                   # measured 0-4 with near-zero pass rate (see
                                   # REF_PASS_RATE_REQUIRED below), so this still
                                   # holds a wide margin against actual obstruction.

# ── Structural-break vote (runtime, vs reference) ──────────────────────────
KP_MATCH_RATIO_THRESHOLD = 0.12
KP_MIN_CURRENT_FEATURES  = 40
ORB_HAMMING_MATCH_MAX    = 40
ORB_N_FEATURES           = 500
SSIM_FALLBACK_THRESHOLD       = 0.60
BLOCK_LOW_FALLBACK_THRESHOLD  = 0.55
BLOCK_SIZE               = 40
BLOCK_LOCAL_SSIM_THRESH  = 0.60
STRUCTURAL_BREAK_CONSEC_FRAMES = 3   # raised from 2 -- one extra frame of margin
                                       # against ordinary RTSP frame-to-frame jitter

# ── Person-presence suppression (NEW) ───────────────────────────────────────
# A person sitting, leaning, or standing close to the camera occludes the
# background the exact same way cloth/polythene does -- fewer structural
# lines visible, low SSIM/ORB match against the empty-room reference. Without
# this, normal occupancy (someone just sitting near the camera) gets flagged
# as OBSTRUCTED/SCENE_CHANGE, which is what you saw in testing. The fix:
# run a lightweight YOLO person check, and if a person is currently occupying
# a meaningful fraction of the frame, treat structural breaks as "probably
# just occlusion by a person", not tamper -- reset the break counter instead
# of escalating to an alarm. If the lens is ACTUALLY covered by cloth, that
# covering persists with nobody standing there holding it, so the moment no
# person is detected, normal detection resumes immediately and still catches
# it -- this does not weaken the cloth/polythene detection, it only stops
# false alarms from ordinary human occupancy.
PERSON_CHECK_ENABLED      = True
PERSON_CHECK_MODEL_PATH   = "yolov8n.pt"   # small + fast is fine here -- this
                                             # is only a presence/coverage gate,
                                             # not identification
PERSON_CHECK_EVERY_N_FRAMES = 3            # run YOLO every Nth analyze() call
PERSON_CHECK_CONF         = 0.35
PERSON_CHECK_W, PERSON_CHECK_H = 320, 240
PERSON_OCCLUDE_FRACTION   = 0.10           # person bbox area / frame area above
                                             # this counts as "occupying enough
                                             # of the view to explain a structural
                                             # break" -- tuned loose on purpose;
                                             # better to suppress a few extra
                                             # frames than false-alarm on someone
                                             # just sitting at a desk in view
PERSON_PRESENCE_TTL_SEC   = 2.5            # how long to keep "a person was just
                                             # here" memory between detections,
                                             # so brief YOLO misses (a frame or
                                             # two) don't immediately flip back
                                             # to "no person" and false-alarm

# ── Reference-build (rolling pass-rate gate, no motion gate) ───────────────
REF_FRAME_BLUR_FLOOR     = 3.0    # reject only near-total-flat degenerate frames
REF_FRAME_STD_FLOOR      = 2.0    # (loose on purpose)
REF_CLEAN_WINDOW_SEC     = 10.0   # rolling window span required before evaluating
REF_PASS_RATE_REQUIRED   = 0.80   # fraction of frames in the window that must
                                   # pass arch_ok -- tolerates natural Hough/Canny
                                   # jitter on a real scene without letting an
                                   # actually covered lens (~0% pass rate) through
REF_BUILD_FRAMES         = 5      # lowered from 45. The old value accumulated
                                   # frames across the ENTIRE post-gate period
                                   # (often 45-135+ seconds on a slow RTSP feed),
                                   # and median-blending across that much real
                                   # time let normal AGC/exposure drift smear
                                   # the composite into a "ghost" image that
                                   # didn't match any single live frame well --
                                   # this is what caused permanently broken
                                   # ssim/kp_ratio (~0.29 / ~0.002) even on a
                                   # totally unchanged scene. A small, tight
                                   # burst captured immediately after the gate
                                   # passes avoids that drift entirely.
REF_MAX_WAIT_SEC         = 180    # 3 minutes before giving up and returning False
REF_RETRY_DELAY_SEC      = 5
REF_AUTO_REFRESH_SEC     = 600    # only refreshes when stream is currently clean
NIGHT_BRIGHTNESS_CUTOFF  = 70.0
NIGHT_HYSTERESIS         = 8.0    # avoids flapping day/night mode right at the boundary

# ── Frame freeze ─────────────────────────────────────────────────────────────
FREEZE_DIFF_THRESHOLD   = 0.4
FREEZE_CONSEC_FRAMES    = 45
FREEZE_BLUR_MAX         = 55.0

# ── Stream health (network-stall watchdog) ──────────────────────────────────
SLOW_READ_WARN_SEC      = 3.0     # a single cap.read() taking this long signals
                                   # a network stall, not a tamper condition

WORK_W, WORK_H = 320, 240

RED    = "\033[91m"
YELLOW = "\033[93m"
GREEN  = "\033[92m"
BOLD   = "\033[1m"
RESET  = "\033[0m"
BELL   = "\a"


def print_alarm(alarms: list, scores: dict):
    ts    = datetime.now().strftime("%H:%M:%S")
    types = " | ".join(a.value for a in alarms)
    line  = "═" * 60
    print(f"\n{RED}{BOLD}{BELL}")
    print(f"  {line}")
    print(f"  🚨  TAMPER DETECTED  —  {ts}")
    print(f"  {line}")
    print(f"  Type       : {types}")
    print(f"  Blur       : {scores.get('blur',   '—')}")
    print(f"  Bright     : {scores.get('bright', '—')}")
    print(f"  Std        : {scores.get('std',    '—')}")
    print(f"  SSIM       : {scores.get('ssim',   '—')}  [{scores.get('ref_mode','—')}]")
    print(f"  KP ratio   : {scores.get('kp_ratio', '—')}  (cur_kp={scores.get('cur_kp', '—')})")
    print(f"  BlockLow   : {scores.get('block_low', '—')}")
    print(f"  LongLines  : {scores.get('long_lines', '—')}")
    print(f"  Motion     : {scores.get('diff', '—')}  (diagnostic only, not gating)")
    print(f"  PersonNear : {scores.get('person_near', '—')}  (suppresses alarm if True)")
    print(f"  {line}")
    print(f"{RESET}", flush=True)


def print_ok(scores: dict, frame_no: int):
    if frame_no % 30 == 0:
        print(
            f"{GREEN}[OK]{RESET} frame={frame_no:>6}  "
            f"blur={scores.get('blur','?'):>7}  "
            f"bright={scores.get('bright','?'):>6}  "
            f"std={scores.get('std','?'):>5}  "
            f"ssim={scores.get('ssim','?'):>6}  "
            f"lines={scores.get('long_lines','?'):>3}  "
            f"[{scores.get('ref_mode','?')}]",
            flush=True
        )


class TamperType(str, Enum):
    DEFOCUS       = "DEFOCUS"
    BLINDED_DARK  = "BLINDED_DARK"
    BLINDED_LIGHT = "BLINDED_LIGHT"
    OBSTRUCTED    = "OBSTRUCTED"
    SCENE_CHANGE  = "SCENE_CHANGE"
    FRAME_FREEZE  = "FRAME_FREEZE"


@dataclass
class TamperResult:
    is_tampered: bool
    alarms:      list = field(default_factory=list)
    scores:      dict = field(default_factory=dict)
    timestamp:   str  = field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")

    def to_event(self, camera_id: str = "cam_ch3") -> dict:
        return {
            "alarm_type": "TAMPER",
            "camera_id":  camera_id,
            "sub_types":  [a.value for a in self.alarms],
            "severity":   "HIGH",
            "timestamp":  self.timestamp,
            "scores":     self.scores,
        }


def architectural_plausibility(gray: np.ndarray) -> int:
    """
    Single-frame, reference-free test: does this look like a real scene
    with architectural structure (walls/doors/furniture edges), or a
    featureless covering surface (cloth/polythene/paint)?

    Returns the count of long straight lines found via CLAHE-boosted,
    adaptively-thresholded Canny + probabilistic Hough transform. Real
    rooms reliably score in the high single digits to dozens (with some
    natural jitter); textured-but-unstructured coverings reliably score
    near zero, REGARDLESS of whether the covering is moving.
    """
    g = cv2.GaussianBlur(gray, (ARCH_PRE_BLUR, ARCH_PRE_BLUR), 0)
    clahe = cv2.createCLAHE(clipLimit=ARCH_CLAHE_CLIP, tileGridSize=ARCH_CLAHE_GRID)
    enhanced = clahe.apply(g)
    med = float(np.median(enhanced))
    lo = int(max(0, ARCH_CANNY_LO_MULT * med))
    hi = int(min(255, ARCH_CANNY_HI_MULT * med))
    edges = cv2.Canny(enhanced, lo, hi)
    lines = cv2.HoughLinesP(
        edges, 1, np.pi / 180,
        threshold=ARCH_HOUGH_VOTE,
        minLineLength=ARCH_HOUGH_MIN_LEN,
        maxLineGap=ARCH_HOUGH_MAX_GAP,
    )
    return 0 if lines is None else len(lines)


class TamperDetector:
    """
    Plug into consumer exactly like FaceDetector / FireDetector:

        detector = TamperDetector(camera_id="cam_ch3")
        ok = detector.initialize(cap)
        if not ok:
            # could not confirm a clean, unobstructed view in time
            ...
        result = detector.analyze(frame)
        if result.is_tampered:
            event_bus.publish(result.to_event())

    initialize() will wait up to REF_MAX_WAIT_SEC, retrying every
    REF_RETRY_DELAY_SEC, for a rolling window of frames where at least
    REF_PASS_RATE_REQUIRED of them pass the architectural-plausibility
    check. If the lens is covered at boot -- even with slight movement --
    it will correctly keep refusing rather than silently adopting the
    covered view as normal, because pass rate stays near 0%.

    For installer-confirmed setup, pass force_accept=True (or call
    confirm_current_frame_as_reference() once the stream is running) to
    skip the automated gate when you have personally verified the view.
    """

    def __init__(self, camera_id: str = "cam_ch3"):
        self.camera_id        = camera_id
        self._ref_day         = None
        self._ref_night       = None
        self._ref_day_des     = None
        self._ref_night_des   = None
        self._prev_gray       = None
        self._freeze_counter  = 0
        self._break_counter   = 0
        self._frame_count     = 0
        self._last_ref_time   = 0.0
        self._initialized     = False
        self._orb = cv2.ORB_create(nfeatures=ORB_N_FEATURES)
        self._bf  = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)

        # Person-presence suppression model (see constants block for why)
        self._last_person_time = 0.0
        self._person_model = None
        if PERSON_CHECK_ENABLED:
            if YOLO is None:
                logger.warning(
                    f"[{self.camera_id}] ultralytics not installed -- person-"
                    f"presence suppression DISABLED. Normal occupancy (people "
                    f"sitting/standing near the camera) may trigger false "
                    f"OBSTRUCTED/SCENE_CHANGE alarms. Run "
                    f"'pip install ultralytics' to enable suppression."
                )
            else:
                try:
                    self._person_model = YOLO(PERSON_CHECK_MODEL_PATH)
                    logger.info(
                        f"[{self.camera_id}] Person-presence suppression "
                        f"enabled ({PERSON_CHECK_MODEL_PATH})."
                    )
                except Exception as e:
                    logger.warning(
                        f"[{self.camera_id}] Could not load {PERSON_CHECK_MODEL_PATH} "
                        f"-- person-presence suppression DISABLED. ({e})"
                    )
                    self._person_model = None

    # ── Public API ───────────────────────────────────────────────────────

    def initialize(self, cap: cv2.VideoCapture, force_accept: bool = False) -> bool:
        if force_accept:
            logger.warning(
                f"[{self.camera_id}] force_accept=True -- skipping automated "
                f"validation. Only use this if you have personally confirmed "
                f"the current view is clean."
            )
            ret, frame = cap.read()
            if not ret or frame is None:
                logger.error("force_accept failed: could not read a frame.")
                return False
            small = cv2.resize(frame, (WORK_W, WORK_H))
            gray  = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            self._adopt_reference(gray, gray)
            return True

        deadline = time.time() + REF_MAX_WAIT_SEC
        attempt = 0
        while time.time() < deadline:
            attempt += 1
            remaining = int(deadline - time.time())
            print(
                f"{YELLOW}[{self.camera_id}] Reference attempt {attempt} "
                f"({remaining}s remaining)...{RESET}", flush=True
            )
            ref_day, ref_night, reason = self._try_build_reference(cap, deadline)
            if ref_day is not None or ref_night is not None:
                self._adopt_reference(
                    ref_day if ref_day is not None else ref_night,
                    ref_night if ref_night is not None else ref_day,
                )
                print(
                    f"{GREEN}[{self.camera_id}] Reference ready. "
                    f"day={'captured' if ref_day is not None else 'fallback'}  "
                    f"night={'captured' if ref_night is not None else 'fallback'}"
                    f"{RESET}\n", flush=True
                )
                return True
            print(
                f"{RED}[{self.camera_id}] Reference rejected: {reason}. "
                f"View does not look like a real, unobstructed scene yet -- "
                f"check for lens covering. Retrying in {REF_RETRY_DELAY_SEC}s..."
                f"{RESET}", flush=True
            )
            time.sleep(REF_RETRY_DELAY_SEC)

        logger.error(
            f"[{self.camera_id}] Could not confirm a clean view within "
            f"{REF_MAX_WAIT_SEC}s. Lens is likely obstructed at startup. "
            f"Returning False."
        )
        return False

    def confirm_current_frame_as_reference(self, frame: np.ndarray) -> None:
        """Manual override for an installer who has visually verified the
        live view. Call once the stream is running, with a frame known to
        be clean."""
        small = cv2.resize(frame, (WORK_W, WORK_H))
        gray  = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        self._adopt_reference(gray, gray)
        logger.info(f"[{self.camera_id}] Reference manually confirmed by operator.")

    def analyze(self, frame: np.ndarray) -> TamperResult:
        if not self._initialized:
            return TamperResult(is_tampered=False)

        self._frame_count += 1
        alarms = []
        scores = {}

        self._update_person_presence(frame)
        person_recently_present = (time.time() - self._last_person_time) <= PERSON_PRESENCE_TTL_SEC
        scores["person_near"] = person_recently_present

        small = cv2.resize(frame, (WORK_W, WORK_H))
        gray  = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

        # ── 1. Blur / Defocus ───────────────────────────────────────────
        lap_var = round(float(cv2.Laplacian(gray, cv2.CV_64F).var()), 2)
        scores["blur"] = lap_var
        if lap_var < BLUR_THRESHOLD:
            alarms.append(TamperType.DEFOCUS)

        # ── 2. Darkness / Overexposure ────────────────────────────────────
        mean_bright = round(float(np.mean(gray)), 2)
        scores["bright"] = mean_bright
        if mean_bright < DARK_THRESHOLD:
            alarms.append(TamperType.BLINDED_DARK)
        elif mean_bright > BRIGHT_THRESHOLD:
            alarms.append(TamperType.BLINDED_LIGHT)

        # ── 3. Global uniformity — spray paint / flat tape ────────────────
        std_dev = round(float(np.std(gray)), 2)
        scores["std"] = std_dev
        blinded = TamperType.BLINDED_DARK in alarms or TamperType.BLINDED_LIGHT in alarms
        if std_dev < UNIFORM_STD_THRESHOLD and not blinded:
            alarms.append(TamperType.OBSTRUCTED)

        # ── 4. Structural-break vote — primary obstruct + scene-change ────
        if TamperType.OBSTRUCTED not in alarms:
            ref, ref_des, ref_mode = self._select_reference(mean_bright)
            scores["ref_mode"] = ref_mode

            ssim_score = round(float(compute_ssim(ref, gray, data_range=255)), 4)
            scores["ssim"] = ssim_score

            kp_ratio, cur_kp = self._kp_match_ratio(gray, ref_des)
            scores["kp_ratio"] = kp_ratio
            scores["cur_kp"]   = cur_kp
            orb_break = (kp_ratio < KP_MATCH_RATIO_THRESHOLD
                         and cur_kp >= KP_MIN_CURRENT_FEATURES)

            fallback_break = False
            if not orb_break and ssim_score < 0.85:
                block_low = round(self._block_low_fraction(ref, gray), 3)
                scores["block_low"] = block_low
                fallback_break = (ssim_score < SSIM_FALLBACK_THRESHOLD
                                   and block_low > BLOCK_LOW_FALLBACK_THRESHOLD)

            # Independent, reference-free third vote: does the CURRENT frame
            # look architecturally real at all, regardless of what the
            # reference says? Catches obstruction even in the unlikely case
            # ORB/SSIM both get fooled.
            long_lines = architectural_plausibility(gray)
            scores["long_lines"] = long_lines
            content_break = long_lines < LINE_MIN_FOR_REAL_SCENE

            structural_break = orb_break or fallback_break or content_break

            if structural_break:
                self._break_counter += 1
            else:
                self._break_counter = 0

            if self._break_counter >= STRUCTURAL_BREAK_CONSEC_FRAMES and lap_var >= BLUR_THRESHOLD:
                if person_recently_present:
                    # Most likely just someone sitting/leaning near the
                    # camera occluding the background -- not tamper. Reset
                    # the counter so it doesn't silently keep accumulating
                    # and then fire the instant they step out of frame.
                    self._break_counter = 0
                elif long_lines < LINE_MIN_FOR_REAL_SCENE:
                    alarms.append(TamperType.OBSTRUCTED)
                # else:
                #     # Temporarily disabled as per user request
                #     alarms.append(TamperType.SCENE_CHANGE)

        # ── 5. Frame freeze ───────────────────────────────────────────────
        if self._prev_gray is not None:
            diff = float(np.mean(cv2.absdiff(self._prev_gray, gray).astype(np.float32)))
            scores["diff"] = round(diff, 4)
            if diff < FREEZE_DIFF_THRESHOLD:
                self._freeze_counter += 1
                if self._freeze_counter >= FREEZE_CONSEC_FRAMES and lap_var < FREEZE_BLUR_MAX:
                    alarms.append(TamperType.FRAME_FREEZE)
            else:
                self._freeze_counter = 0
        self._prev_gray = gray.copy()

        # ── Auto-refresh reference — ONLY when clean AND architecturally
        #    plausible. A tampered view can never become the new reference.
        if (not alarms
                and scores.get("long_lines", 0) >= LINE_MIN_FOR_REAL_SCENE
                and REF_AUTO_REFRESH_SEC > 0
                and (time.time() - self._last_ref_time) > REF_AUTO_REFRESH_SEC):
            ref_mode = scores.get("ref_mode", "day")
            kp, des = self._orb.detectAndCompute(gray, None)
            if ref_mode == "day":
                self._ref_day, self._ref_day_des = gray.copy(), des
            else:
                self._ref_night, self._ref_night_des = gray.copy(), des
            self._last_ref_time = time.time()
            logger.info(f"[{self.camera_id}] Reference auto-refreshed ({ref_mode} mode).")

        return TamperResult(is_tampered=bool(alarms), alarms=alarms, scores=scores)

    # ── Internal: reference adoption / selection ────────────────────────

    def _adopt_reference(self, ref_day_gray: np.ndarray, ref_night_gray: np.ndarray):
        self._ref_day   = ref_day_gray
        self._ref_night = ref_night_gray
        _, self._ref_day_des   = self._orb.detectAndCompute(ref_day_gray, None)
        _, self._ref_night_des = self._orb.detectAndCompute(ref_night_gray, None)
        self._last_ref_time = time.time()
        self._initialized    = True

    def _update_person_presence(self, frame: np.ndarray) -> None:
        """Run a cheap, throttled YOLO person check. If a person currently
        occupies a meaningful fraction of the frame, remember the timestamp
        -- this is what lets analyze() distinguish 'someone is sitting near
        the camera' from 'the lens is actually covered'."""
        if self._person_model is None:
            return
        if self._frame_count % PERSON_CHECK_EVERY_N_FRAMES != 0:
            return
        try:
            small = cv2.resize(frame, (PERSON_CHECK_W, PERSON_CHECK_H))
            results = self._person_model(
                small, classes=[0], conf=PERSON_CHECK_CONF, verbose=False
            )
            frame_area = float(PERSON_CHECK_W * PERSON_CHECK_H)
            for r in results:
                for box in r.boxes:
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    area = abs(x2 - x1) * abs(y2 - y1)
                    if (area / frame_area) >= PERSON_OCCLUDE_FRACTION:
                        self._last_person_time = time.time()
                        return
        except Exception as e:
            logger.warning(f"[{self.camera_id}] Person check failed: {e}")

    def _select_reference(self, mean_bright: float) -> Tuple[np.ndarray, Optional[np.ndarray], str]:
        # hysteresis band avoids flapping mode right at the brightness boundary
        if mean_bright < (NIGHT_BRIGHTNESS_CUTOFF - NIGHT_HYSTERESIS):
            return self._ref_night, self._ref_night_des, "night"
        elif mean_bright > (NIGHT_BRIGHTNESS_CUTOFF + NIGHT_HYSTERESIS):
            return self._ref_day, self._ref_day_des, "day"
        else:
            # in the boundary band, prefer whichever reference is closer
            # in brightness to the current frame
            d_day   = abs(float(np.mean(self._ref_day))   - mean_bright)
            d_night = abs(float(np.mean(self._ref_night)) - mean_bright)
            return (self._ref_day, self._ref_day_des, "day") if d_day <= d_night \
                   else (self._ref_night, self._ref_night_des, "night")

    # ── Internal: structural-break helper signals (vs reference) ───────────

    def _kp_match_ratio(self, gray: np.ndarray, ref_des) -> Tuple[float, int]:
        kp, des = self._orb.detectAndCompute(gray, None)
        cur_kp = len(kp)
        if ref_des is None or len(ref_des) == 0 or des is None or len(des) == 0:
            return 0.0, cur_kp
        matches = self._bf.match(ref_des, des)
        good = [m for m in matches if m.distance < ORB_HAMMING_MATCH_MAX]
        return round(len(good) / max(len(ref_des), 1), 3), cur_kp

    def _block_low_fraction(self, ref_gray: np.ndarray, gray: np.ndarray, block: int = BLOCK_SIZE) -> float:
        h, w = gray.shape
        low, total = 0, 0
        for y in range(0, h - block + 1, block):
            for x in range(0, w - block + 1, block):
                s = compute_ssim(ref_gray[y:y+block, x:x+block], gray[y:y+block, x:x+block], data_range=255)
                total += 1
                if s < BLOCK_LOCAL_SSIM_THRESH:
                    low += 1
        return low / max(total, 1)

    # ── Internal: reference building (rolling pass-rate gate) ──────────────

    def _try_build_reference(
        self, cap: cv2.VideoCapture, outer_deadline: float
    ) -> Tuple[Optional[np.ndarray], Optional[np.ndarray], str]:
        frames_bright, frames_dark = [], []
        # Count-based rolling buffer (NOT time-bucketed). A time-windowed
        # deque that pops entries once they age past REF_CLEAN_WINDOW_SEC
        # has a real bug on slow/irregular frame sources (e.g. a 2560x1440
        # RTSP stream where each cap.read() can take ~1-3s): the moment the
        # oldest entry's age would cross the window boundary, popping it
        # immediately drags window_span back under the threshold again, so
        # it can oscillate at the boundary forever and never trigger even
        # at 100% pass rate. Tracking elapsed wall-clock time since the
        # start of the current good streak (reset only when the ROLLING
        # pass rate itself drops, not on a single time-bucket edge case)
        # avoids this entirely and was verified against the actual slow
        # frame-arrival pattern seen on this camera.
        ok_history: deque = deque(maxlen=60)
        clean_start = None
        last_diag_print = 0.0
        last_motion_diag = 0.0
        prev_gray = None
        per_attempt_deadline = min(outer_deadline, time.time() + REF_MAX_WAIT_SEC / 3)
        rejection_reason = "timed out waiting for a stable, plausible scene"
        MIN_SAMPLES = 5  # need at least this many readings before trusting pass_rate

        while time.time() < per_attempt_deadline:
            ret, frame = cap.read()
            if not ret or frame is None:
                time.sleep(0.05)
                continue

            small = cv2.resize(frame, (WORK_W, WORK_H))
            gray  = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

            blur   = float(cv2.Laplacian(gray, cv2.CV_64F).var())
            std    = float(np.std(gray))
            bright = float(np.mean(gray))

            # Sanity floor only — loose, not a discriminator
            floor_ok = (blur >= REF_FRAME_BLUR_FLOOR and std >= REF_FRAME_STD_FLOOR)

            # Primary signal — architectural plausibility
            long_lines = architectural_plausibility(gray)
            arch_ok = long_lines >= LINE_MIN_FOR_REAL_SCENE

            # Motion: diagnostic only, never gates
            if prev_gray is not None:
                motion = float(np.mean(cv2.absdiff(prev_gray, gray).astype(np.float32)))
                last_motion_diag = motion
            prev_gray = gray.copy()

            now = time.time()
            ok_history.append(arch_ok and floor_ok)
            pass_rate = (sum(ok_history) / len(ok_history)) if len(ok_history) >= MIN_SAMPLES else 0.0

            if pass_rate >= REF_PASS_RATE_REQUIRED:
                if clean_start is None:
                    clean_start = now
                elapsed = now - clean_start
            else:
                clean_start = None
                elapsed = 0.0

            if elapsed >= REF_CLEAN_WINDOW_SEC:
                # Gate just passed — capture a TIGHT burst right now, back-to-
                # back with no extra processing delay between reads, instead
                # of trickling frames in across the (potentially long, slow)
                # main loop. This is what actually prevents AGC/exposure
                # drift from smearing the median reference (see
                # REF_BUILD_FRAMES comment above for why this matters).
                burst = [gray.astype(np.float32)]
                for _ in range(REF_BUILD_FRAMES - 1):
                    ret_b, frame_b = cap.read()
                    if not ret_b or frame_b is None:
                        continue
                    small_b = cv2.resize(frame_b, (WORK_W, WORK_H))
                    gray_b  = cv2.cvtColor(small_b, cv2.COLOR_BGR2GRAY)
                    burst.append(gray_b.astype(np.float32))

                if bright >= NIGHT_BRIGHTNESS_CUTOFF:
                    frames_bright = burst
                else:
                    frames_dark = burst
                break
            elif now - last_diag_print > 3:
                print(
                    f"{YELLOW}  Validating scene... elapsed={elapsed:.0f}/"
                    f"{REF_CLEAN_WINDOW_SEC:.0f}s  pass_rate={pass_rate*100:.0f}%"
                    f"(need {REF_PASS_RATE_REQUIRED*100:.0f}%, n={len(ok_history)})   "
                    f"long_lines={long_lines}  blur={blur:.0f}  std={std:.1f}  "
                    f"motion={last_motion_diag:.2f} (diagnostic){RESET}", flush=True
                )
                last_diag_print = now
                if pass_rate < 0.15 and len(ok_history) >= MIN_SAMPLES:
                    rejection_reason = (
                        f"sustained low pass_rate={pass_rate*100:.0f}% "
                        f"(looks covered/featureless)"
                    )

            time.sleep(0.04)

        ref_day = np.median(frames_bright, axis=0).astype(np.uint8) if len(frames_bright) >= REF_BUILD_FRAMES // 2 else None
        ref_night = np.median(frames_dark, axis=0).astype(np.uint8) if len(frames_dark) >= REF_BUILD_FRAMES // 2 else None

        if ref_day is None and ref_night is None:
            return None, None, rejection_reason
        return ref_day, ref_night, ""


# ── Stream helpers ───────────────────────────────────────────────────────

def _open_rtsp(url: str, retries: int = 5, delay: float = 3.0) -> cv2.VideoCapture:
    for attempt in range(1, retries + 1):
        logger.info(f"Connecting to stream (attempt {attempt}/{retries})...")
        cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 2)
        if cap.isOpened():
            ret, frame = cap.read()
            if ret and frame is not None:
                h, w = frame.shape[:2]
                logger.info(f"Stream opened — {w}x{h}")
                return cap
        cap.release()
        logger.warning(f"Retrying in {delay}s...")
        time.sleep(delay)
    raise RuntimeError(f"Cannot open stream after {retries} attempts.")


class ConsumerTamperDetector:
    def __init__(self):
        self.detectors = {}
        
    def detect(self, frame, camera_id, person_boxes=None):
        if camera_id not in self.detectors:
            detector = TamperDetector(camera_id=camera_id)
            detector.confirm_current_frame_as_reference(frame)
            self.detectors[camera_id] = detector
            
        detector = self.detectors[camera_id]
        result = detector.analyze(frame)
        
        out = {}
        if result.is_tampered:
            alarms_str = " | ".join([a.value for a in result.alarms])
            # Highlight tamper on frame
            cv2.rectangle(frame, (0, 0), (frame.shape[1], frame.shape[0]), (0, 0, 255), 3)
            cv2.putText(frame, f"TAMPER: {alarms_str}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
            out["tamper"] = alarms_str
            out["frame"] = frame
            
        return out


def main():
    print(f"\n{BOLD}{'═'*60}")
    print(f"  GyanAkshi VMS — Tamper Detector (rolling pass-rate v4)")
    print(f"  Stream : {RTSP_URL[:55]}...")
    print(f"  Press  : Q to quit")
    print(f"{'═'*60}{RESET}\n", flush=True)

    cap      = _open_rtsp(RTSP_URL)
    detector = TamperDetector(camera_id="cam_ch3")

    if not detector.initialize(cap):
        print(
            f"\n{RED}{BOLD}  ❌  Could not confirm a clean view — lens may be "
            f"obstructed (e.g. cloth/polythene) since startup."
            f"\n  Remove any obstruction and restart, or call "
            f"confirm_current_frame_as_reference() once verified.{RESET}\n",
            flush=True
        )
        cap.release()
        sys.exit(1)

    consecutive_failures = 0
    last_alarm_types     = set()

    while True:
        read_start = time.time()
        ret, frame = cap.read()
        read_elapsed = time.time() - read_start
        if read_elapsed > SLOW_READ_WARN_SEC:
            logger.warning(
                f"Slow frame read ({read_elapsed:.1f}s) — likely a network "
                f"stall, not a tamper condition."
            )

        if not ret or frame is None:
            consecutive_failures += 1
            if consecutive_failures >= 30:
                logger.error("Stream lost — reconnecting...")
                cap.release()
                try:
                    cap = _open_rtsp(RTSP_URL)
                    detector.initialize(cap)
                    consecutive_failures = 0
                except RuntimeError as e:
                    logger.critical(str(e))
                    break
            time.sleep(0.1)
            continue

        consecutive_failures = 0
        result = detector.analyze(frame)

        if result.is_tampered:
            current_types = set(a.value for a in result.alarms)
            if current_types != last_alarm_types:
                print_alarm(result.alarms, result.scores)
                last_alarm_types = current_types
        else:
            if last_alarm_types:
                print(f"\n{GREEN}{BOLD}  ✅  Tamper cleared — stream normal{RESET}\n", flush=True)
            last_alarm_types = set()
            print_ok(result.scores, detector._frame_count)

        # ── Preview ───────────────────────────────────────────────────────
        display = cv2.resize(frame, (WORK_W, WORK_H))
        color   = (0, 0, 255) if result.is_tampered else (0, 200, 0)
        label   = ("TAMPER: " + " | ".join(a.value for a in result.alarms)) if result.is_tampered else "OK"

        cv2.rectangle(display, (0, 0), (WORK_W, WORK_H), color, 3)
        cv2.putText(display, label, (8, 22),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.52, color, 2, cv2.LINE_AA)
        line1 = (
            f"blur:{result.scores.get('blur','?')}  bright:{result.scores.get('bright','?')}  "
            f"std:{result.scores.get('std','?')}  ssim:{result.scores.get('ssim','?')}"
        )
        line2 = (
            f"kpr:{result.scores.get('kp_ratio','?')}  lines:{result.scores.get('long_lines','?')}  "
            f"motion:{result.scores.get('diff','?')}  person:{result.scores.get('person_near','?')}  "
            f"[{result.scores.get('ref_mode','?')}]"
        )
        cv2.putText(display, line1, (6, WORK_H - 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.34, (220, 220, 220), 1, cv2.LINE_AA)
        cv2.putText(display, line2, (6, WORK_H - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.34, (220, 220, 220), 1, cv2.LINE_AA)

        cv2.imshow("GyanAkshi — Tamper Detector  [Q=quit]", display)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

        time.sleep(0.03)

    cap.release()
    cv2.destroyAllWindows()
    print(f"\n{YELLOW}Detector stopped.{RESET}")


if __name__ == "__main__":
    main()
