load("encoding/json.star", "json")
load("render.star", "render")

def main(config):
    data = json.decode(config.get("payload_json") or "{}")
    display = data.get("display") or {}
    children = [
        render.Padding(pad = (3, 2, 0, 0), child = render.Text(content = display.get("name") or "BABY", font = "tom-thumb", color = display.get("accent") or "#A8D8BE")),
        render.Padding(pad = (display.get("primaryX") or 0, 9, 0, 0), child = render.Text(content = display.get("primary") or "--", font = "6x13", color = "#FFF6EC")),
        render.Padding(pad = (3, 25, 0, 0), child = render.Text(content = display.get("secondary") or "", font = "tom-thumb", color = display.get("secondaryColor") or "#B4C9BF")),
    ]
    heart = [".xx..xx.", "xxxxxxxx", "xxxxxxxx", ".xxxxxx.", "..xxxx..", "...xx..."]
    for y, row in enumerate(heart):
        for x in range(len(row)):
            if row[x] == "x":
                children.append(render.Padding(pad = (53 + x, 1 + y, 0, 0), child = render.Box(width = 1, height = 1, color = display.get("accent") or "#A8D8BE")))
    return render.Root(child = render.Stack(children = children))
