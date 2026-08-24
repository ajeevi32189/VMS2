import json
import os
from fastapi import FastAPI, HTTPException, Path, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
from typing import Optional, List
from datetime import datetime

# ──────────────────────────────────────────────
# App Setup
# ──────────────────────────────────────────────
app = FastAPI(
    title="ROI Management API",
    description="""
## Region of Interest (ROI) API
Manage ROIs with bounding-box sections that determine priority levels.
    """,
    version="3.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ──────────────────────────────────────────────
# Constants & File Setup
# ──────────────────────────────────────────────
SECTION_PRIORITY_MAP = {1: "LOW", 2: "MEDIUM", 3: "HIGH"}
PRIORITY_COLOR_MAP   = {"LOW": "#22c55e", "MEDIUM": "#f59e0b", "HIGH": "#ef4444"}
BOX_COORDINATE_COUNT = 4
DATA_FILE = "data/roi_data.json"

def load_data() -> dict:
    """Load ROI data from JSON file."""
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r") as f:
                return json.load(f)
        except json.JSONDecodeError:
            return {}
    return {}

def save_data(data: dict):
    """Save ROI data to JSON file."""
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=4)

# In-Memory Store initialized from JSON file
roi_store: dict[str, dict] = load_data()


# ──────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────
class Coordinate(BaseModel):
    x: float = Field(..., description="X — pixel value or normalized float")
    y: float = Field(..., description="Y — pixel value or normalized float")

class BoundingBox(BaseModel):
    top_left:     Coordinate
    top_right:    Coordinate
    bottom_right: Coordinate
    bottom_left:  Coordinate

    @validator("bottom_right")
    def validate_box_geometry(cls, bottom_right, values):
        tl = values.get("top_left")
        tr = values.get("top_right")
        if tl and tr and bottom_right:
            if abs(tr.x - tl.x) == 0 or abs(bottom_right.y - tl.y) == 0:
                raise ValueError("Bounding box has zero area.")
        return bottom_right

    def to_coordinate_list(self) -> list[dict]:
        return [
            {"corner": "top-left",     "x": self.top_left.x,     "y": self.top_left.y},
            {"corner": "top-right",    "x": self.top_right.x,    "y": self.top_right.y},
            {"corner": "bottom-right", "x": self.bottom_right.x, "y": self.bottom_right.y},
            {"corner": "bottom-left",  "x": self.bottom_left.x,  "y": self.bottom_left.y},
        ]

class ROISection(BaseModel):
    section_level: int = Field(..., ge=1, le=3, description="1=LOW  2=MEDIUM  3=HIGH")
    bounding_box:  BoundingBox
    label:         Optional[str] = Field(None, max_length=100)

class ROICreateRequest(BaseModel):
    name:        str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    camera_id:   str = Field(..., description="Source camera ID (must be unique)")
    sections:    List[ROISection] = Field(..., min_items=1, max_items=3)

    @validator("sections")
    def unique_section_levels(cls, sections):
        levels = [s.section_level for s in sections]
        if len(levels) != len(set(levels)):
            raise ValueError("Each section_level (1, 2, 3) must appear at most once per ROI.")
        return sections

class ROIUpdateRequest(BaseModel):
    name:        Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    camera_id:   Optional[str] = None
    sections:    Optional[List[ROISection]] = Field(None, min_items=1, max_items=3)

    @validator("sections")
    def unique_section_levels(cls, sections):
        if sections is None:
            return sections
        levels = [s.section_level for s in sections]
        if len(levels) != len(set(levels)):
            raise ValueError("Each section_level must be unique.")
        return sections


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────
def _serialize_section(sec: ROISection) -> dict:
    priority = SECTION_PRIORITY_MAP[sec.section_level]
    return {
        "section_level": sec.section_level,
        "priority": priority, # Added directly to JSON for easy reading
        "label": sec.label or f"Section {sec.section_level}",
        "coordinates": sec.bounding_box.to_coordinate_list(),
    }

def _enrich_roi(roi: dict) -> dict:
    enriched = roi.copy()
    enriched_sections = []
    for sec in enriched.get("sections", []):
        priority = sec.get("priority", SECTION_PRIORITY_MAP[sec["section_level"]])
        coords = sec.get("coordinates", [])
        bbox = {pt["corner"].replace("-", "_"): {"x": pt["x"], "y": pt["y"]} for pt in coords}
        
        enriched_sections.append({
            **sec,
            "priority_color": PRIORITY_COLOR_MAP[priority],
            "coordinate_count": BOX_COORDINATE_COUNT,
            "bounding_box": bbox,
        })
    enriched["sections"] = enriched_sections
    return enriched

def _roi_not_found(camera_id: str):
    raise HTTPException(status_code=404, detail=f"ROI for camera '{camera_id}' not found.")


# ──────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────

# ── GET all ───────────────────────────────────
@app.get("/api/v1/rois", summary="List all ROIs", tags=["ROI"])
def list_rois(
    camera_id: Optional[str] = Query(None, description="Filter by camera ID"),
    priority: Optional[str] = Query(None, description="Filter: low | medium | high")
):
    priority_upper = priority.strip().upper() if priority else None
    if priority_upper and priority_upper not in ("LOW", "MEDIUM", "HIGH"):
        raise HTTPException(status_code=422, detail="Invalid priority. Allowed: low, medium, high.")

    results = [_enrich_roi(r) for r in roi_store.values()]

    if camera_id:
        results = [r for r in results if r.get("camera_id") == camera_id]

    if priority_upper:
        results = [r for r in results if any(s["priority"] == priority_upper for s in r["sections"])]

    return {"total": len(results), "rois": results}


# ── GET single by camera_id ───────────────────
@app.get("/api/v1/rois/{camera_id}", summary="Get ROI by Camera ID", tags=["ROI"])
def get_roi(camera_id: str = Path(..., description="Camera ID")):
    if camera_id not in roi_store:
        _roi_not_found(camera_id)
    return _enrich_roi(roi_store[camera_id])


# ── POST create ───────────────────────────────
# ── POST create (Updated with Merge/Upsert Logic) ──────────────
@app.post("/api/v1/rois", status_code=201, summary="Create or Add sections to ROI", tags=["ROI"])
def create_roi(payload: ROICreateRequest):
    now = datetime.utcnow().isoformat() + "Z"

    # Agar camera_id already exist karta hai, toh hum sections ko merge kar denge
    if payload.camera_id in roi_store:
        existing = roi_store[payload.camera_id]
        
        # Purane sections ko ek dictionary mein daal lo taaki update/add karne mein aasani ho
        existing_sections = {sec["section_level"]: sec for sec in existing["sections"]}

        # Naye aane wale sections ko add ya overwrite karo
        for new_sec in payload.sections:
            existing_sections[new_sec.section_level] = _serialize_section(new_sec)

        # Wapas list mein convert karke sort kar do (1=LOW, 2=MEDIUM, 3=HIGH)
        existing["sections"] = [
            existing_sections[lvl]
            for lvl in sorted(existing_sections.keys())
        ]
        
        # Metadata update karo
        existing["updated_at"] = now
        if payload.name: existing["name"] = payload.name
        if payload.description: existing["description"] = payload.description

        roi_store[payload.camera_id] = existing
        save_data(roi_store) # Update JSON file
        
        return {"message": f"Existing ROI for camera '{payload.camera_id}' updated with new sections.", "roi": _enrich_roi(existing)}

    # Agar camera_id naya hai, toh normal Create logic chalega
    roi_data = {
        "camera_id": payload.camera_id,
        "name": payload.name,
        "description": payload.description,
        "sections": [
            _serialize_section(sec)
            for sec in sorted(payload.sections, key=lambda s: s.section_level)
        ],
        "created_at": now,
        "updated_at": now,
    }

    roi_store[payload.camera_id] = roi_data
    save_data(roi_store) # Update JSON file
    
    return {"message": "New ROI created and saved to JSON successfully.", "roi": _enrich_roi(roi_data)}
# ── PUT update by camera_id ───────────────────
@app.put("/api/v1/rois/{camera_id}", summary="Update an existing ROI", tags=["ROI"])
def update_roi(
    payload: ROIUpdateRequest,
    camera_id: str = Path(..., description="Camera ID to update"),
):
    if camera_id not in roi_store:
        _roi_not_found(camera_id)

    existing = roi_store[camera_id]
    new_cam = payload.camera_id

    # Handle camera_id change logic
    if new_cam and new_cam != camera_id:
        if new_cam in roi_store:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot update: Camera '{new_cam}' already has an ROI.",
            )
        # Shift data to new key and delete old key
        roi_store[new_cam] = roi_store.pop(camera_id)
        camera_id = new_cam 
        existing["camera_id"] = new_cam

    # Update other fields
    if payload.name is not None: existing["name"] = payload.name
    if payload.description is not None: existing["description"] = payload.description
    if payload.sections is not None:
        existing["sections"] = [
            _serialize_section(sec)
            for sec in sorted(payload.sections, key=lambda s: s.section_level)
        ]

    existing["updated_at"] = datetime.utcnow().isoformat() + "Z"
    roi_store[camera_id] = existing
    
    save_data(roi_store) # Update JSON file

    return {"message": "ROI updated successfully.", "roi": _enrich_roi(existing)}


# ── DELETE single by camera_id ────────────────
@app.delete("/api/v1/rois/{camera_id}", summary="Delete an ROI by Camera ID", tags=["ROI"])
def delete_roi(camera_id: str = Path(..., description="Camera ID")):
    if camera_id not in roi_store:
        _roi_not_found(camera_id)
        
    deleted = roi_store.pop(camera_id)
    save_data(roi_store) # Update JSON file
    
    return {"message": f"ROI for camera '{camera_id}' deleted.", "camera_id": camera_id}


# ── Health ────────────────────────────────────
@app.get("/health", tags=["System"], summary="Health check")
def health():
    return {
        "status": "ok",
        "roi_count": len(roi_store),
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }



















# """
# ROI (Region of Interest) Management API
# ========================================
# Priority Levels:
#   Section 1 → LOW    priority
#   Section 2 → MEDIUM priority
#   Section 3 → HIGH   priority

# Coordinate Rule:
#   Each section requires EXACTLY 4 coordinates forming a bounding box:
#     [top-left, top-right, bottom-right, bottom-left]

# Duplicate Rule:
#   Ek camera_id ke liye sirf EK active ROI allowed hai.
#   Naya create karne se pehle purana DELETE karo, ya usse UPDATE karo.
# """

# from fastapi import FastAPI, HTTPException, Path, Query
# from fastapi.middleware.cors import CORSMiddleware
# from pydantic import BaseModel, Field, validator
# from typing import Optional, List
# from datetime import datetime
# import uuid

# # ──────────────────────────────────────────────
# # App Setup
# # ──────────────────────────────────────────────
# app = FastAPI(
#     title="ROI Management API",
#     description="""
# ## Region of Interest (ROI) API

# Manage ROIs with **bounding-box** sections that determine priority levels.

# | Section | Priority | Color  |
# |---------|----------|--------|
# | 1       | 🟢 LOW    | Green  |
# | 2       | 🟡 MEDIUM | Amber  |
# | 3       | 🔴 HIGH   | Red    |

# ### Coordinate Convention (exactly 4 points per section)
# ```
# top-left ──── top-right
#    |                |
# bottom-left ── bottom-right
# ```

# ### ⚠️ Duplicate Rule
# - Ek `camera_id` ke liye **sirf ek ROI** allowed hai.
# - Naya banane se pehle purana `DELETE` karo ya `PUT` se update karo.
#     """,
#     version="3.0.0",
#     docs_url="/docs",
#     redoc_url="/redoc",
# )

# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=["*"],
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
# )

# # ──────────────────────────────────────────────
# # In-Memory Store
# # ──────────────────────────────────────────────
# roi_store: dict[str, dict] = {}

# # ──────────────────────────────────────────────
# # Constants
# # ──────────────────────────────────────────────
# SECTION_PRIORITY_MAP = {1: "LOW", 2: "MEDIUM", 3: "HIGH"}
# PRIORITY_COLOR_MAP   = {"LOW": "#22c55e", "MEDIUM": "#f59e0b", "HIGH": "#ef4444"}
# BOX_COORDINATE_COUNT = 4


# # ──────────────────────────────────────────────
# # Schemas
# # ──────────────────────────────────────────────
# class Coordinate(BaseModel):
#     x: float = Field(..., description="X — pixel value or normalized float")
#     y: float = Field(..., description="Y — pixel value or normalized float")


# class BoundingBox(BaseModel):
#     top_left:     Coordinate = Field(..., description="Corner 0 — top-left")
#     top_right:    Coordinate = Field(..., description="Corner 1 — top-right")
#     bottom_right: Coordinate = Field(..., description="Corner 2 — bottom-right")
#     bottom_left:  Coordinate = Field(..., description="Corner 3 — bottom-left")

#     @validator("bottom_right")
#     def validate_box_geometry(cls, bottom_right, values):
#         tl = values.get("top_left")
#         tr = values.get("top_right")
#         if tl and tr and bottom_right:
#             if abs(tr.x - tl.x) == 0 or abs(bottom_right.y - tl.y) == 0:
#                 raise ValueError(
#                     "Bounding box has zero area — top-left and bottom-right must be different points."
#                 )
#         return bottom_right

#     def to_coordinate_list(self) -> list[dict]:
#         return [
#             {"corner": "top-left",     "x": self.top_left.x,     "y": self.top_left.y},
#             {"corner": "top-right",    "x": self.top_right.x,    "y": self.top_right.y},
#             {"corner": "bottom-right", "x": self.bottom_right.x, "y": self.bottom_right.y},
#             {"corner": "bottom-left",  "x": self.bottom_left.x,  "y": self.bottom_left.y},
#         ]

#     class Config:
#         schema_extra = {"example": {
#             "top_left":     {"x": 50,  "y": 30},
#             "top_right":    {"x": 300, "y": 30},
#             "bottom_right": {"x": 300, "y": 250},
#             "bottom_left":  {"x": 50,  "y": 250},
#         }}


# class ROISection(BaseModel):
#     section_level: int            = Field(..., ge=1, le=3, description="1=LOW  2=MEDIUM  3=HIGH")
#     bounding_box:  BoundingBox    = Field(..., description="Exactly 4 corner coordinates")
#     label:         Optional[str]  = Field(None, max_length=100)

#     class Config:
#         schema_extra = {"example": {
#             "section_level": 1,
#             "label": "Outer Zone",
#             "bounding_box": {
#                 "top_left":     {"x": 0,   "y": 0},
#                 "top_right":    {"x": 640, "y": 0},
#                 "bottom_right": {"x": 640, "y": 200},
#                 "bottom_left":  {"x": 0,   "y": 200},
#             },
#         }}


# class ROICreateRequest(BaseModel):
#     name:        str            = Field(..., min_length=1, max_length=100)
#     description: Optional[str] = Field(None, max_length=500)
#     camera_id:   str            = Field(..., description="Source camera / stream ID (must be unique)")
#     sections:    List[ROISection] = Field(..., min_items=1, max_items=3)

#     @validator("sections")
#     def unique_section_levels(cls, sections):
#         levels = [s.section_level for s in sections]
#         if len(levels) != len(set(levels)):
#             raise ValueError("Each section_level (1, 2, 3) must appear at most once per ROI.")
#         return sections

#     class Config:
#         schema_extra = {"example": {
#             "name": "Parking Zone A",
#             "description": "Front entrance monitoring",
#             "camera_id": "cam_01",
#             "sections": [
#                 {
#                     "section_level": 1,
#                     "label": "Outer Zone (Low)",
#                     "bounding_box": {
#                         "top_left":     {"x": 0,   "y": 0},
#                         "top_right":    {"x": 640, "y": 0},
#                         "bottom_right": {"x": 640, "y": 200},
#                         "bottom_left":  {"x": 0,   "y": 200},
#                     },
#                 },
#                 {
#                     "section_level": 2,
#                     "label": "Middle Zone (Medium)",
#                     "bounding_box": {
#                         "top_left":     {"x": 100, "y": 200},
#                         "top_right":    {"x": 540, "y": 200},
#                         "bottom_right": {"x": 540, "y": 360},
#                         "bottom_left":  {"x": 100, "y": 360},
#                     },
#                 },
#                 {
#                     "section_level": 3,
#                     "label": "Inner Zone (High)",
#                     "bounding_box": {
#                         "top_left":     {"x": 200, "y": 360},
#                         "top_right":    {"x": 440, "y": 360},
#                         "bottom_right": {"x": 440, "y": 480},
#                         "bottom_left":  {"x": 200, "y": 480},
#                     },
#                 },
#             ],
#         }}


# class ROIUpdateRequest(BaseModel):
#     name:        Optional[str]            = Field(None, min_length=1, max_length=100)
#     description: Optional[str]            = Field(None, max_length=500)
#     camera_id:   Optional[str]            = None
#     sections:    Optional[List[ROISection]] = Field(None, min_items=1, max_items=3)

#     @validator("sections")
#     def unique_section_levels(cls, sections):
#         if sections is None:
#             return sections
#         levels = [s.section_level for s in sections]
#         if len(levels) != len(set(levels)):
#             raise ValueError("Each section_level must be unique.")
#         return sections


# # ──────────────────────────────────────────────
# # Helpers
# # ──────────────────────────────────────────────
# def _serialize_section(sec: ROISection) -> dict:
#     return {
#         "section_level": sec.section_level,
#         "label":         sec.label or f"Section {sec.section_level}",
#         "coordinates":   sec.bounding_box.to_coordinate_list(),
#     }


# def _enrich_roi(roi: dict) -> dict:
#     enriched = roi.copy()
#     enriched_sections = []
#     for sec in enriched.get("sections", []):
#         priority = SECTION_PRIORITY_MAP[sec["section_level"]]
#         coords   = sec.get("coordinates", [])
#         bbox = {
#             pt["corner"].replace("-", "_"): {"x": pt["x"], "y": pt["y"]}
#             for pt in coords
#         }
#         enriched_sections.append({
#             **sec,
#             "priority":         priority,
#             "priority_color":   PRIORITY_COLOR_MAP[priority],
#             "coordinate_count": BOX_COORDINATE_COUNT,
#             "bounding_box":     bbox,
#         })
#     enriched["sections"] = enriched_sections
#     return enriched


# def _get_roi_by_camera(camera_id: str) -> Optional[dict]:
#     """Return existing ROI for a camera_id, or None."""
#     for roi in roi_store.values():
#         if roi.get("camera_id") == camera_id:
#             return roi
#     return None


# def _roi_not_found(roi_id: str):
#     raise HTTPException(status_code=404, detail=f"ROI '{roi_id}' not found.")


# # ──────────────────────────────────────────────
# # Routes
# # ──────────────────────────────────────────────

# # ── GET all ───────────────────────────────────
# @app.get("/api/v1/rois", summary="List all ROIs", tags=["ROI"])
# def list_rois(
#     priority:  Optional[str] = Query(None, description="Filter: low | medium | high (case-insensitive)"),
#     camera_id: Optional[str] = Query(None, description="Filter by camera ID"),
# ):
#     if priority is not None:
#         priority_upper = priority.strip().upper()
#         if priority_upper not in ("LOW", "MEDIUM", "HIGH"):
#             raise HTTPException(
#                 status_code=422,
#                 detail=f"Invalid priority '{priority}'. Allowed: low, medium, high.",
#             )
#     else:
#         priority_upper = None

#     results = [_enrich_roi(r) for r in roi_store.values()]

#     if priority_upper:
#         results = [r for r in results if any(s["priority"] == priority_upper for s in r["sections"])]
#     if camera_id:
#         results = [r for r in results if r.get("camera_id") == camera_id]

#     return {"total": len(results), "rois": results}


# # ── GET single ────────────────────────────────
# @app.get("/api/v1/rois/{roi_id}", summary="Get ROI by ID", tags=["ROI"])
# def get_roi(roi_id: str = Path(..., description="ROI UUID")):
#     if roi_id not in roi_store:
#         _roi_not_found(roi_id)
#     return _enrich_roi(roi_store[roi_id])


# # ── POST create ───────────────────────────────
# @app.post("/api/v1/rois", status_code=201, summary="Create a new ROI", tags=["ROI"])
# def create_roi(payload: ROICreateRequest):
#     """
#     Create a new ROI.

#     ### ⚠️ Duplicate Prevention
#     Agar **isi `camera_id` ka ROI already exist karta hai** toh `409 Conflict` milega.
#     Us case mein ya toh:
#     - Purana ROI **DELETE** karo aur naya banao, ya
#     - Purane ko **PUT** se update karo.

#     ### Priority Mapping
#     | section_level | Priority |
#     |---|---|
#     | 1 | 🟢 LOW |
#     | 2 | 🟡 MEDIUM |
#     | 3 | 🔴 HIGH |
#     """
#     # ── Duplicate check ──────────────────────
#     existing = _get_roi_by_camera(payload.camera_id)
#     if existing:
#         raise HTTPException(
#             status_code=409,
#             detail={
#                 "error":   "duplicate_camera_roi",
#                 "message": f"Camera '{payload.camera_id}' ka ROI already exist karta hai. "
#                            f"Pehle DELETE karo ya PUT se update karo.",
#                 "existing_roi_id":   existing["id"],
#                 "existing_roi_name": existing["name"],
#                 "hint": f"DELETE /api/v1/rois/{existing['id']}  ya  PUT /api/v1/rois/{existing['id']}",
#             },
#         )

#     roi_id = str(uuid.uuid4())
#     now    = datetime.utcnow().isoformat() + "Z"

#     roi_data = {
#         "id":          roi_id,
#         "name":        payload.name,
#         "description": payload.description,
#         "camera_id":   payload.camera_id,
#         "sections": [
#             _serialize_section(sec)
#             for sec in sorted(payload.sections, key=lambda s: s.section_level)
#         ],
#         "created_at": now,
#         "updated_at": now,
#     }

#     roi_store[roi_id] = roi_data
#     return {"message": "ROI created successfully.", "roi": _enrich_roi(roi_data)}


# # ── PUT update ────────────────────────────────
# @app.put("/api/v1/rois/{roi_id}", summary="Update an existing ROI", tags=["ROI"])
# def update_roi(
#     payload: ROIUpdateRequest,
#     roi_id:  str = Path(..., description="ROI UUID"),
# ):
#     """
#     Sirf jo fields bhejo woh update honge — baaki same rahenge.
#     `sections` bhejne par saare sections replace ho jaate hain.
#     """
#     if roi_id not in roi_store:
#         _roi_not_found(roi_id)

#     existing = roi_store[roi_id]

#     # ── if camera_id change ho raha hai, check new one for duplicate ──
#     new_cam = payload.camera_id
#     if new_cam and new_cam != existing["camera_id"]:
#         conflict = _get_roi_by_camera(new_cam)
#         if conflict:
#             raise HTTPException(
#                 status_code=409,
#                 detail={
#                     "error":   "duplicate_camera_roi",
#                     "message": f"Camera '{new_cam}' ka ROI already exist karta hai (id: {conflict['id']}).",
#                 },
#             )

#     if payload.name        is not None: existing["name"]        = payload.name
#     if payload.description is not None: existing["description"] = payload.description
#     if payload.camera_id   is not None: existing["camera_id"]   = payload.camera_id
#     if payload.sections    is not None:
#         existing["sections"] = [
#             _serialize_section(sec)
#             for sec in sorted(payload.sections, key=lambda s: s.section_level)
#         ]

#     existing["updated_at"] = datetime.utcnow().isoformat() + "Z"
#     roi_store[roi_id] = existing

#     return {"message": "ROI updated successfully.", "roi": _enrich_roi(existing)}


# # ── DELETE single ─────────────────────────────
# @app.delete("/api/v1/rois/{roi_id}", summary="Delete an ROI by ID", tags=["ROI"])
# def delete_roi(roi_id: str = Path(..., description="ROI UUID")):
#     if roi_id not in roi_store:
#         _roi_not_found(roi_id)
#     deleted = roi_store.pop(roi_id)
#     return {"message": f"ROI '{deleted['name']}' deleted.", "id": roi_id}


# # ── DELETE all (store reset) ──────────────────
# @app.delete("/api/v1/rois", summary="Delete ALL ROIs (reset store)", tags=["ROI"])
# def delete_all_rois():
#     """
#     **Saare ROIs ek saath delete karo.**
#     Useful jab testing ke dauran memory mein purana data jama ho jaye.
#     """
#     count = len(roi_store)
#     roi_store.clear()
#     return {"message": f"All {count} ROI(s) deleted.", "deleted_count": count}


# # ── Health ────────────────────────────────────
# @app.get("/health", tags=["System"], summary="Health check")
# def health():
#     return {
#         "status":     "ok",
#         "roi_count":  len(roi_store),
#         "timestamp":  datetime.utcnow().isoformat() + "Z",
#     }

























# # """
# # ROI (Region of Interest) Management API
# # ========================================
# # Priority Levels:
# #   Section 1 → LOW    priority
# #   Section 2 → MEDIUM priority
# #   Section 3 → HIGH   priority

# # Coordinate Rule:
# #   Each section requires EXACTLY 4 coordinates forming a bounding box:
# #     [top-left, top-right, bottom-right, bottom-left]
# # """

# # from fastapi import FastAPI, HTTPException, Path, Query
# # from fastapi.middleware.cors import CORSMiddleware
# # from pydantic import BaseModel, Field, validator
# # from typing import Optional, List
# # from datetime import datetime
# # from enum import IntEnum
# # import uuid

# # # ──────────────────────────────────────────────
# # # App Setup
# # # ──────────────────────────────────────────────
# # app = FastAPI(
# #     title="ROI Management API",
# #     description="""
# # ## Region of Interest (ROI) API

# # Manage ROIs with **bounding-box** sections that determine priority levels.

# # | Section | Priority | Color  |
# # |---------|----------|--------|
# # | 1       | 🟢 LOW    | Green  |
# # | 2       | 🟡 MEDIUM | Amber  |
# # | 3       | 🔴 HIGH   | Red    |

# # ### Coordinate Convention (exactly 4 points per section)
# # ```
# # (x1,y1) ──── (x2,y2)
# #    |               |
# # (x4,y4) ──── (x3,y3)
# # ```
# # | Index | Corner        |
# # |-------|---------------|
# # | 0     | top-left      |
# # | 1     | top-right     |
# # | 2     | bottom-right  |
# # | 3     | bottom-left   |

# # Coordinates can be **pixel values** or **normalized floats (0.0 – 1.0)**.
# #     """,
# #     version="2.0.0",
# #     docs_url="/docs",
# #     redoc_url="/redoc",
# # )

# # app.add_middleware(
# #     CORSMiddleware,
# #     allow_origins=["*"],
# #     allow_credentials=True,
# #     allow_methods=["*"],
# #     allow_headers=["*"],
# # )

# # # ──────────────────────────────────────────────
# # # In-Memory Store  (swap with DB when ready)
# # # ──────────────────────────────────────────────
# # roi_store: dict[str, dict] = {}


# # # ──────────────────────────────────────────────
# # # Constants
# # # ──────────────────────────────────────────────
# # SECTION_PRIORITY_MAP = {1: "LOW", 2: "MEDIUM", 3: "HIGH"}
# # PRIORITY_COLOR_MAP   = {"LOW": "#22c55e", "MEDIUM": "#f59e0b", "HIGH": "#ef4444"}
# # CORNER_LABELS        = ["top-left", "top-right", "bottom-right", "bottom-left"]
# # BOX_COORDINATE_COUNT = 4


# # # ──────────────────────────────────────────────
# # # Schemas
# # # ──────────────────────────────────────────────
# # class Coordinate(BaseModel):
# #     x: float = Field(..., description="X — pixel value or normalized float (0.0–1.0)")
# #     y: float = Field(..., description="Y — pixel value or normalized float (0.0–1.0)")

# #     class Config:
# #         schema_extra = {"example": {"x": 120.0, "y": 80.0}}


# # class BoundingBox(BaseModel):
# #     """
# #     Exactly 4 coordinates representing the corners of a rectangular ROI zone.

# #     Order: top-left → top-right → bottom-right → bottom-left
# #     """
# #     top_left:     Coordinate = Field(..., description="Corner 0 — top-left")
# #     top_right:    Coordinate = Field(..., description="Corner 1 — top-right")
# #     bottom_right: Coordinate = Field(..., description="Corner 2 — bottom-right")
# #     bottom_left:  Coordinate = Field(..., description="Corner 3 — bottom-left")

# #     @validator("bottom_right")
# #     def validate_box_geometry(cls, bottom_right, values):
# #         """Ensure the box is valid (non-zero area, consistent orientation)."""
# #         tl = values.get("top_left")
# #         tr = values.get("top_right")
# #         if tl and tr and bottom_right:
# #             width  = abs(tr.x - tl.x)
# #             height = abs(bottom_right.y - tl.y)
# #             if width == 0 or height == 0:
# #                 raise ValueError(
# #                     "Bounding box has zero area. "
# #                     "top-left and bottom-right corners must be different points."
# #                 )
# #         return bottom_right

# #     def to_coordinate_list(self) -> list[dict]:
# #         """Return the 4 corners as an ordered list (for storage & response)."""
# #         return [
# #             {"corner": "top-left",     "x": self.top_left.x,     "y": self.top_left.y},
# #             {"corner": "top-right",    "x": self.top_right.x,    "y": self.top_right.y},
# #             {"corner": "bottom-right", "x": self.bottom_right.x, "y": self.bottom_right.y},
# #             {"corner": "bottom-left",  "x": self.bottom_left.x,  "y": self.bottom_left.y},
# #         ]

# #     class Config:
# #         schema_extra = {
# #             "example": {
# #                 "top_left":     {"x": 50,  "y": 30},
# #                 "top_right":    {"x": 300, "y": 30},
# #                 "bottom_right": {"x": 300, "y": 250},
# #                 "bottom_left":  {"x": 50,  "y": 250},
# #             }
# #         }


# # class ROISection(BaseModel):
# #     """
# #     A single priority section within an ROI.
# #     section_level → 1 = LOW | 2 = MEDIUM | 3 = HIGH
# #     """
# #     section_level: int = Field(
# #         ..., ge=1, le=3,
# #         description="Priority level: 1=LOW, 2=MEDIUM, 3=HIGH",
# #     )
# #     bounding_box: BoundingBox = Field(
# #         ...,
# #         description="Exactly 4 corner coordinates defining the rectangular zone",
# #     )
# #     label: Optional[str] = Field(None, max_length=100, description="Optional display label")

# #     class Config:
# #         schema_extra = {
# #             "example": {
# #                 "section_level": 2,
# #                 "label": "Entrance Gate",
# #                 "bounding_box": {
# #                     "top_left":     {"x": 50,  "y": 30},
# #                     "top_right":    {"x": 300, "y": 30},
# #                     "bottom_right": {"x": 300, "y": 250},
# #                     "bottom_left":  {"x": 50,  "y": 250},
# #                 },
# #             }
# #         }


# # class ROICreateRequest(BaseModel):
# #     name:        str           = Field(..., min_length=1, max_length=100)
# #     description: Optional[str] = Field(None, max_length=500)
# #     camera_id:   Optional[str] = Field(None, description="Source camera / stream ID")
# #     sections: List[ROISection] = Field(
# #         ..., min_items=1, max_items=3,
# #         description="1–3 priority sections (each with its own bounding box)",
# #     )

# #     @validator("sections")
# #     def unique_section_levels(cls, sections):
# #         levels = [s.section_level for s in sections]
# #         if len(levels) != len(set(levels)):
# #             raise ValueError(
# #                 "Each section_level (1, 2, 3) must appear at most once per ROI."
# #             )
# #         return sections

# #     class Config:
# #         schema_extra = {
# #             "example": {
# #                 "name": "Parking Zone A",
# #                 "description": "Front entrance parking monitoring",
# #                 "camera_id": "cam_01",
# #                 "sections": [
# #                     {
# #                         "section_level": 1,
# #                         "label": "Outer Zone (Low)",
# #                         "bounding_box": {
# #                             "top_left":     {"x": 0,   "y": 0},
# #                             "top_right":    {"x": 640, "y": 0},
# #                             "bottom_right": {"x": 640, "y": 200},
# #                             "bottom_left":  {"x": 0,   "y": 200},
# #                         },
# #                     },
# #                     {
# #                         "section_level": 2,
# #                         "label": "Middle Zone (Medium)",
# #                         "bounding_box": {
# #                             "top_left":     {"x": 100, "y": 200},
# #                             "top_right":    {"x": 540, "y": 200},
# #                             "bottom_right": {"x": 540, "y": 360},
# #                             "bottom_left":  {"x": 100, "y": 360},
# #                         },
# #                     },
# #                     {
# #                         "section_level": 3,
# #                         "label": "Inner Zone (High)",
# #                         "bounding_box": {
# #                             "top_left":     {"x": 200, "y": 360},
# #                             "top_right":    {"x": 440, "y": 360},
# #                             "bottom_right": {"x": 440, "y": 480},
# #                             "bottom_left":  {"x": 200, "y": 480},
# #                         },
# #                     },
# #                 ],
# #             }
# #         }


# # class ROIUpdateRequest(BaseModel):
# #     name:        Optional[str]            = Field(None, min_length=1, max_length=100)
# #     description: Optional[str]            = Field(None, max_length=500)
# #     camera_id:   Optional[str]            = None
# #     sections:    Optional[List[ROISection]] = Field(None, min_items=1, max_items=3)

# #     @validator("sections")
# #     def unique_section_levels(cls, sections):
# #         if sections is None:
# #             return sections
# #         levels = [s.section_level for s in sections]
# #         if len(levels) != len(set(levels)):
# #             raise ValueError("Each section_level must be unique.")
# #         return sections


# # # ──────────────────────────────────────────────
# # # Helpers
# # # ──────────────────────────────────────────────
# # def _serialize_section(sec: ROISection) -> dict:
# #     return {
# #         "section_level": sec.section_level,
# #         "label":         sec.label or f"Section {sec.section_level}",
# #         "coordinates":   sec.bounding_box.to_coordinate_list(),   # always exactly 4
# #     }


# # def _enrich_roi(roi: dict) -> dict:
# #     """
# #     Add derived fields to every section:
# #       - priority / priority_color
# #       - coordinate_count (always 4)
# #       - bounding_box dict  <- ready for analytics point-in-box checks
# #       - coordinates list   <- ordered [TL, TR, BR, BL] with corner labels
# #     """
# #     enriched = roi.copy()
# #     enriched_sections = []

# #     for sec in enriched.get("sections", []):
# #         priority = SECTION_PRIORITY_MAP[sec["section_level"]]
# #         coords   = sec.get("coordinates", [])

# #         # Build named bounding_box dict for easy analytics use
# #         bbox = {}
# #         for pt in coords:
# #             key = pt["corner"].replace("-", "_")   # "top-left" -> "top_left"
# #             bbox[key] = {"x": pt["x"], "y": pt["y"]}

# #         enriched_sections.append({
# #             **sec,
# #             "priority":         priority,
# #             "priority_color":   PRIORITY_COLOR_MAP[priority],
# #             "coordinate_count": BOX_COORDINATE_COUNT,
# #             "bounding_box":     bbox,
# #         })

# #     enriched["sections"] = enriched_sections
# #     return enriched


# # def _roi_not_found(roi_id: str):
# #     raise HTTPException(status_code=404, detail=f"ROI '{roi_id}' not found.")


# # # ──────────────────────────────────────────────
# # # Routes
# # # ──────────────────────────────────────────────

# # @app.get("/api/v1/rois", summary="List all ROIs", tags=["ROI"])
# # def list_rois(
# #     priority:  Optional[str] = Query(
# #         None,
# #         description="Filter by priority (case-insensitive): low | medium | high",
# #     ),
# #     camera_id: Optional[str] = Query(None, description="Filter by camera ID"),
# # ):
# #     """
# #     Return all ROIs with optional filters.

# #     - `priority` is **case-insensitive** — `low`, `Low`, `LOW` all work.
# #     - Each section in the response includes its 4 bounding-box coordinates
# #       ready to use in your analytics pipeline.
# #     """
# #     # ── validate priority value (case-insensitive) ──
# #     if priority is not None:
# #         priority_upper = priority.strip().upper()
# #         if priority_upper not in ("LOW", "MEDIUM", "HIGH"):
# #             raise HTTPException(
# #                 status_code=422,
# #                 detail=f"Invalid priority '{priority}'. Allowed values: low, medium, high (case-insensitive).",
# #             )
# #     else:
# #         priority_upper = None

# #     results = [_enrich_roi(r) for r in roi_store.values()]

# #     if priority_upper:
# #         results = [
# #             r for r in results
# #             if any(s["priority"] == priority_upper for s in r["sections"])
# #         ]
# #     if camera_id:
# #         results = [r for r in results if r.get("camera_id") == camera_id]

# #     return {"total": len(results), "rois": results}


# # @app.get("/api/v1/rois/{roi_id}", summary="Get ROI by ID", tags=["ROI"])
# # def get_roi(roi_id: str = Path(..., description="ROI UUID")):
# #     if roi_id not in roi_store:
# #         _roi_not_found(roi_id)
# #     return _enrich_roi(roi_store[roi_id])


# # @app.post("/api/v1/rois", status_code=201, summary="Create a new ROI", tags=["ROI"])
# # def create_roi(payload: ROICreateRequest):
# #     """
# #     Create a new ROI with **1–3 bounding-box sections**.

# #     ### Rules
# #     - Each section must have **exactly 4 coordinates** (top-left → top-right → bottom-right → bottom-left).
# #     - Each `section_level` (1, 2, 3) can appear **only once** per ROI.
# #     - Bounding box must have **non-zero area** (no collapsed boxes).

# #     ### Priority Mapping
# #     | section_level | Priority |
# #     |---------------|----------|
# #     | 1             | 🟢 LOW   |
# #     | 2             | 🟡 MEDIUM|
# #     | 3             | 🔴 HIGH  |
# #     """
# #     roi_id = str(uuid.uuid4())
# #     now    = datetime.utcnow().isoformat() + "Z"

# #     roi_data = {
# #         "id":          roi_id,
# #         "name":        payload.name,
# #         "description": payload.description,
# #         "camera_id":   payload.camera_id,
# #         "sections": [
# #             _serialize_section(sec)
# #             for sec in sorted(payload.sections, key=lambda s: s.section_level)
# #         ],
# #         "created_at": now,
# #         "updated_at": now,
# #     }

# #     roi_store[roi_id] = roi_data
# #     return {"message": "ROI created successfully.", "roi": _enrich_roi(roi_data)}


# # @app.put("/api/v1/rois/{roi_id}", summary="Update an existing ROI", tags=["ROI"])
# # def update_roi(
# #     payload: ROIUpdateRequest,
# #     roi_id:  str = Path(..., description="ROI UUID"),
# # ):
# #     """
# #     Partially update an ROI — only send what you want to change.
# #     If `sections` is provided, all sections are replaced with the new ones
# #     (each must still have exactly 4 bounding-box coordinates).
# #     """
# #     if roi_id not in roi_store:
# #         _roi_not_found(roi_id)

# #     existing = roi_store[roi_id]

# #     if payload.name        is not None: existing["name"]        = payload.name
# #     if payload.description is not None: existing["description"] = payload.description
# #     if payload.camera_id   is not None: existing["camera_id"]   = payload.camera_id

# #     if payload.sections is not None:
# #         existing["sections"] = [
# #             _serialize_section(sec)
# #             for sec in sorted(payload.sections, key=lambda s: s.section_level)
# #         ]

# #     existing["updated_at"] = datetime.utcnow().isoformat() + "Z"
# #     roi_store[roi_id] = existing

# #     return {"message": "ROI updated successfully.", "roi": _enrich_roi(existing)}


# # @app.delete("/api/v1/rois/{roi_id}", summary="Delete an ROI", tags=["ROI"])
# # def delete_roi(roi_id: str = Path(..., description="ROI UUID")):
# #     if roi_id not in roi_store:
# #         _roi_not_found(roi_id)

# #     deleted = roi_store.pop(roi_id)
# #     return {"message": f"ROI '{deleted['name']}' deleted successfully.", "id": roi_id}


# # @app.get("/health", tags=["System"], summary="Health check")
# # def health():
# #     return {"status": "ok", "timestamp": datetime.utcnow().isoformat() + "Z"}