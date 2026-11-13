"""Ask a vision model whether a portrait shows one illustrated animal character standing upright like a person."""
import base64
import json
import re
from urllib.error import HTTPError
from urllib.request import Request, urlopen

# Pinned snapshot, the same model the recognition review uses.
MODEL = "gpt-5.4-mini-2026-03-17"
QUESTIONS = ("single_character", "illustrated", "animal", "upright_humanoid", "two_legs", "four_legged", "real_photo")
PROMPT = """You screen portraits for a game that turns a player's character into a walking sprite on a human-shaped body.
First name the main character's species in a few words, for example "raccoon", "frog", "crow", "octopus" or "human".
Then answer each question about the image with true or false.
single_character: exactly one character is the subject. Small background figures do not count.
illustrated: the character is drawn, painted or rendered art, not a photograph of a real animal or person.
animal: the character's head is an animal, bird, reptile or amphibian head with a muzzle, snout or beak, not a human face. A human, elf, demon, dwarf or other person with animal ears, horns, face paint, a mask or a costume is false.
upright_humanoid: the character stands or sits upright like a person, or the visible chest, shoulders, arms or clothing show a person-shaped upper body. A bust portrait of a clothed or armored animal counts as upright.
two_legs: the character has two legs it could walk on like a person, or, in a bust portrait, nothing suggests otherwise. An octopus, squid, snake, fish or other creature with tentacles, a serpent or fish tail, or no legs is false, even when it wears clothes or stands upright.
four_legged: the character stands or walks on four legs like an ordinary animal.
real_photo: the image is a photograph of a real animal, person or object."""


def request_body(png, model=MODEL):
    # The species comes first so the answers follow from what the model says it sees.
    properties = {"species": {"type": "string"}, **{key: {"type": "boolean"} for key in QUESTIONS}}
    schema = {"type": "object", "additionalProperties": False, "properties": properties, "required": list(properties)}
    image = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
    return {"model": model, "store": False, "instructions": PROMPT, "max_output_tokens": 256,
            "input": [{"role": "user", "content": [{"type": "input_image", "detail": "high", "image_url": image}]}],
            "text": {"format": {"type": "json_schema", "name": "upright_animal", "strict": True, "schema": schema}}}


def verdict(response, model=MODEL):
    """Only a complete answer from the pinned model can admit a portrait."""
    if (not isinstance(response, dict) or response.get("status") != "completed" or response.get("model") != model
            or response.get("error") is not None or response.get("incomplete_details") is not None
            or not isinstance(response.get("output"), list)):
        raise ValueError("upright-animal-response-incomplete")
    texts = [part.get("text") for item in response["output"] if isinstance(item, dict) and item.get("type") == "message"
             for part in item.get("content") or () if isinstance(part, dict) and part.get("type") == "output_text"]
    if len(texts) != 1 or not isinstance(texts[0], str) or len(texts[0]) > 1024:
        raise ValueError("upright-animal-response-content")
    answer = json.loads(texts[0])
    if (not isinstance(answer, dict) or set(answer) != {"species", *QUESTIONS}
            or any(type(answer[k]) is not bool for k in QUESTIONS)
            or not isinstance(answer["species"], str) or not 0 < len(answer["species"]) <= 80):
        raise ValueError("upright-animal-response-schema")
    return answer


def admits(answer):
    return (answer["single_character"] and answer["illustrated"] and answer["animal"] and answer["upright_humanoid"]
            and answer["two_legs"] and not answer["four_legged"] and not answer["real_photo"])


def ask(png, api_key, model=MODEL):
    """One HTTPS request with no retries. A missing key or a provider error raises, never admits."""
    if not api_key or not re.fullmatch(r"[A-Za-z0-9._-]{1,120}", model):
        raise ValueError("upright-animal-unavailable")
    request = Request("https://api.openai.com/v1/responses", method="POST",
                      data=json.dumps(request_body(png, model)).encode(),
                      headers={"Authorization": "Bearer " + api_key, "Content-Type": "application/json"})
    try:
        response = urlopen(request, timeout=90)
    except HTTPError as error:
        raise ValueError("upright-animal-provider-" + str(error.code)) from error
    with response:
        raw = response.read(64 * 1024 + 1)
    if len(raw) > 64 * 1024:
        raise ValueError("upright-animal-response-size")
    return verdict(json.loads(raw), model)
