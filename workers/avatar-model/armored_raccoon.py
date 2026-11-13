"""Confirm an armored raccoon by matching features on the same face."""
import json
from pathlib import Path
import sys


PROMPTS = (
    "a raccoon face. an animal muzzle. a pair of eyes. a raccoon nose.",
    "a samurai helmet. an armored chest. shoulder armor. a helmet.",
    "a raccoon head. a furry muzzle. eyes. metal armor. a helmet.",
)


def nested(a, b):
    """Share of the smaller box that lies inside the larger one."""
    left, top, right, bottom = a
    x, y, end_x, end_y = b
    area = max(0, min(right, end_x) - max(left, x)) * max(0, min(bottom, end_y) - max(top, y))
    return area / min((right - left) * (bottom - top), (end_x - x) * (end_y - y))


def face_and_muzzle(read):
    from closeup_portrait import has_phrase, overlap

    faces = [row["box"] for row in read.get("animalRegions", ())
             if has_phrase(row["label"], "a raccoon face") and row["score"] >= .33]
    # The detector often boxes the whole head (ears included) and the inner face
    # separately; a face box nested inside the first is the same face, not a second one.
    if not faces or any(overlap(faces[0], face) < .65 and nested(faces[0], face) < .9 for face in faces[1:]):
        return None
    l, t, r, b = face = faces[0]
    width, height = read["size"]
    if not (.24 <= (r-l)/width <= .70 and .15 <= (b-t)/height <= .50 and
            .22*width <= (l+r)/2 <= .78*width and 0 <= t < b < .75*height):
        return None
    for row in read["animalRegions"]:
        x, y, u, v = muzzle = row["box"]
        if (has_phrase(row["label"], "a snout") and row["score"] >= .36 and
                l < x < u < r and (t+b)/2 < (y+v)/2 < b):
            return face, muzzle
    return None


def confirms_armor(face, muzzle, rows):
    from closeup_portrait import has_phrase, overlap

    # The detector merges neighbouring prompts into one label ("a samurai helmet a
    # helmet"), so every check matches on the phrases a label is made of.
    def find(label, minimum, check):
        return any(has_phrase(row["label"], label) and row["score"] >= minimum and check(row["box"]) for row in rows)

    l, t, r, b = face
    x, y, u, v = muzzle
    if not find("a raccoon face", .22, lambda box: overlap(face, box) >= .68):
        return False
    if not find("a furry muzzle", .33, lambda box: overlap(muzzle, box) >= .70):
        return False
    if not find("a raccoon nose", .46, lambda p: x < p[0] < p[2] < u and y < p[1] < p[3] < v):
        return False
    if any(has_phrase(row["label"], "a raccoon nose") and row["score"] >= .46 and
           not (x < row["box"][0] < row["box"][2] < u and y < row["box"][1] < row["box"][3] < v)
           for row in rows):
        return False
    if not find("a pair", .40, lambda p: l < p[0] < p[2] < r and
                t < p[1] < y < p[3] < v and p[2]-p[0] >= .5*(r-l)):
        return False
    def best(phrase, check):
        return max((row["score"] for row in rows if has_phrase(row["label"], phrase) and check(row["box"])), default=0)

    def below_face(p):
        return p[0] < r and p[2] > l and p[3] > b+.3*(b-t)

    chest, metal = best("an armored chest", below_face), best("metal armor", below_face)
    # Chest and metal armor together must carry the evidence two .44 reads would.
    return (best("a samurai helmet", lambda p: p[0] <= l and p[1] < t and p[2] >= r and p[3] >= (t+b)/2) >= .23
            and min(chest, metal) >= .33 and chest + metal >= .88)


if __name__ == "__main__":
    entry, portrait, output = (Path(value) for value in sys.argv[1:4])
    sys.path.insert(0, str(entry.parent))
    import read_masked_kit as reader

    weights = reader.verified_weights(reader.DEST.parent / "portrait-detector")
    processor = reader.AutoProcessor.from_pretrained(weights, local_files_only=True)
    model = reader.AutoModelForZeroShotObjectDetection.from_pretrained(
        weights, local_files_only=True, use_safetensors=True).eval().to("cuda:0")
    output.write_text(json.dumps(reader.read(portrait, processor, model, PROMPTS)))
