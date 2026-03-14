import os

file_path = "c:/Users/muhdk/.gemini/antigravity/scratch/mejin-apps/src/App.jsx"

with open(file_path, "r", encoding="utf-8") as f:
    lines = f.readlines()

# Convert to 0-indexed for Python
start_idx = 1501 # Line 1502
end_idx = 1845   # Line 1846
insert_idx = 1251 # Line 1252

block_to_move = lines[start_idx:end_idx + 1]

# Remove the block from its current location
del lines[start_idx:end_idx + 1]

# The insert index doesn't shift because the deletion happens *after* the insertion point
# So we can safely insert at insert_idx
lines = lines[:insert_idx] + block_to_move + lines[insert_idx:]

with open(file_path, "w", encoding="utf-8") as f:
    f.writelines(lines)

print("Moved lines successfully!")
