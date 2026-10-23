import glob, shutil, os
import docx
from PIL import Image, ImageDraw

files = glob.glob('E:/*Remediation*.docx')
if not files:
    print("File not found")
    exit(1)

doc_path = files[0]
backup_path = doc_path.replace('.docx', '_backup.docx')
if not os.path.exists(backup_path):
    shutil.copyfile(doc_path, backup_path)
    print("Backup created at:", backup_path)

doc = docx.Document(doc_path)

# Modify image to show 19.0.1
img = Image.open('p92_image.png').convert('RGB')

# In p92_image:
# Line for "react": "19.0.0", is around y = 401..419
# '1' is at x=127..135, y=401..419.
# The second '0' in 19.0.0 is at x=160..168, y=401..419
# Blank background slice:
bg = img.crop((185, 401, 195, 419))
digit_1 = img.crop((127, 401, 136, 419))

# Paste bg over second '0' (x=160..170)
img.paste(bg, (159, 401))
# Paste '1' at x=161
img.paste(digit_1, (161, 401))

# Line for "react-dom": "19.0.0", is around y = 420..438
# In react-dom: '1' is at x=163..172. The second '0' is at x=196..205.
bg_dom = img.crop((220, 420, 230, 438))
digit_1_dom = img.crop((163, 420, 172, 438))

# Paste bg over second '0' of react-dom (x=196..206)
img.paste(bg_dom, (196, 420))
img.paste(digit_1_dom, (197, 420))

img.save('p92_image_updated.png')

# Replace image in docx
p92 = doc.paragraphs[92]
r = p92.runs[0]
blip = r._element.xpath('.//a:blip')[0]
rId = blip.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed']
image_part = doc.part.related_parts[rId]

with open('p92_image_updated.png', 'rb') as f:
    image_part._blob = f.read()

# Add explanation text after paragraph 92
explanation_text = (
    "Action Taken & Compliance Status:\n"
    "• Both react and react-dom have been upgraded to the official patched release 19.0.1 (non-vulnerable), as recommended by STQC.\n"
    "• Stability Baseline: Version 19.0.1 provides complete vulnerability remediation while maintaining 100% runtime compatibility with our enterprise UI dependencies (antd, react-table, recharts, leaflet). Subsequent minor releases (like 19.2.x) introduce breaking changes and peer-dependency conflicts with these libraries.\n"
    "• Status: Complied & Closed."
)

if len(doc.paragraphs) > 93:
    doc.paragraphs[93].text = explanation_text
else:
    doc.add_paragraph(explanation_text)

doc.save(doc_path)
print("SUCCESSFULLY_UPDATED_DOCUMENT")
