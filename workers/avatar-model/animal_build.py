"""Ask whether an upright animal's portrait shows it dressed or bare-bodied.

The two are painted differently (owner, 2026-11-21). A dressed animal, like the armored raccoon or a tiger in
a coat, is painted exactly as before: its coat, trousers and boots fill the rig's cutouts well. A bare one,
like a cartoon dinosaur, used to come back in invented boots and a scarf, with its hips painted as a coat
hem: it is now painted in its own skin, scales or fur, with its own feet. Any failure answers "dressed", so
this question can only ever leave a painting as it was."""
import base64
import json
import re
from urllib.error import HTTPError
from urllib.request import Request, urlopen

# Pinned snapshot, the same model the upright-animal screen asks.
MODEL = "gpt-5.4-mini-2026-03-17"
PROMPT = """You look at a portrait of one animal character for a game that paints it onto a human-shaped body.
First name what the character wears in a few words, for example "blue coat and armor", "red scarf only" or "nothing".
Then answer with true or false.
dressed: the character wears clothing or armor on its body or legs, such as a shirt, coat, robe, dress, armor, trousers, shorts, a uniform or boots. A scarf, collar, necklace, bow, hat, glasses or other small accessory alone is false. Fur, feathers, scales, skin, markings and a bare belly are not clothing. In a portrait that shows only the head and shoulders, answer from what is visible."""


STOCKY_TEMPLATE = "stocky-template.json"
STOCKY_FIELDS = ("bare_animal", "whole_body_visible", "large_head", "short_legs", "round_belly")
STOCKY_PROMPT = """Inspect the primary illustrated character. Ignore scenery and small background creatures.
bare_animal: an animal character walking on two feet, with no clothing, armor or boots on its body or legs. People in animal costumes and people with animal ears are false.
whole_body_visible: the head, hips, legs and feet are visible enough to judge standing proportions.
large_head: the head itself is at least one third of standing height, excluding headwear.
short_legs: the distance from hips to soles is at most about one third of standing height.
round_belly: a broad rounded belly and compact cartoon body. Answer false wherever uncertain."""


def stocky_review_available(release, source, approved_sources):
    # The final blind review needs three distinct alternatives to this portrait.
    other_portraits = set(approved_sources) - {"", source}
    return STOCKY_TEMPLATE in release.get("paintedTemplates", ()) and len(other_portraits) >= 3


def request_body(png, model=MODEL, *, proportions=False):
    properties = {"wears": {"type": "string"}, "dressed": {"type": "boolean"}}
    if proportions:
        properties = {key: {"type": "boolean"} for key in STOCKY_FIELDS}
    schema = {"type": "object", "additionalProperties": False, "properties": properties, "required": list(properties)}
    image = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
    return {"model": model, "store": False, "instructions": STOCKY_PROMPT if proportions else PROMPT, "max_output_tokens": 1024,
            "input": [{"role": "user", "content": [{"type": "input_image", "detail": "high", "image_url": image}]}],
            "text": {"format": {"type": "json_schema", "name": "animal_build", "strict": True, "schema": schema}}}


def verdict(response, model=MODEL, *, proportions=False):
    """"bare" or "dressed" from one complete answer of the pinned model; anything else raises."""
    if (not isinstance(response, dict) or response.get("status") != "completed" or response.get("model") != model
            or response.get("error") is not None or response.get("incomplete_details") is not None
            or not isinstance(response.get("output"), list)):
        raise ValueError("animal-build-response-incomplete")
    texts = [part.get("text") for item in response["output"] if isinstance(item, dict) and item.get("type") == "message"
             for part in item.get("content") or () if isinstance(part, dict) and part.get("type") == "output_text"]
    if len(texts) != 1 or not isinstance(texts[0], str) or len(texts[0]) > 1024:
        raise ValueError("animal-build-response-content")
    answer = json.loads(texts[0])
    if proportions:
        if (not isinstance(answer, dict) or set(answer) != set(STOCKY_FIELDS)
                or any(type(answer[key]) is not bool for key in STOCKY_FIELDS)):
            raise ValueError("stocky-build-response-schema")
        return all(answer.values())
    if (not isinstance(answer, dict) or set(answer) != {"wears", "dressed"} or type(answer["dressed"]) is not bool
            or not isinstance(answer["wears"], str) or not 0 < len(answer["wears"]) <= 120):
        raise ValueError("animal-build-response-schema")
    return "dressed" if answer["dressed"] else "bare"


def ask(png, api_key, model=MODEL, *, proportions=False):
    """One HTTPS request with no retries. A missing key or a provider error raises."""
    if not api_key or not re.fullmatch(r"[A-Za-z0-9._-]{1,120}", model):
        raise ValueError("animal-build-unavailable")
    request = Request("https://api.openai.com/v1/responses", method="POST",
                      data=json.dumps(request_body(png, model, proportions=proportions)).encode(),
                      headers={"Authorization": "Bearer " + api_key, "Content-Type": "application/json"})
    try:
        response = urlopen(request, timeout=90)
    except HTTPError as error:
        raise ValueError("animal-build-provider-" + str(error.code)) from error
    with response:
        raw = response.read(64 * 1024 + 1)
    if len(raw) > 64 * 1024:
        raise ValueError("animal-build-response-size")
    return verdict(json.loads(raw), model, proportions=proportions)


def decide(work, png, asker):
    """The build for this job, asked once and kept in the job's work folder, so a second painting round and a
    resumed call paint the same way (a repair must replay its first painting's prompt). Any failure is
    "dressed", kept the same way: the painting stays exactly as before."""
    record = work / "animal-build.json"
    try:
        saved = json.loads(record.read_bytes())
        if saved in ("bare", "dressed"):
            return saved
    except (OSError, ValueError):
        pass
    try:
        build = asker(png)
        if build not in ("bare", "dressed"):
            raise ValueError("animal-build-answer")
        print("animal-build", build, flush=True)
    except Exception as error:  # noqa: BLE001
        print("animal-build-skipped", type(error).__name__, flush=True)
        build = "dressed"
    record.write_text(json.dumps(build))
    return build
