load("encoding/json.star", "json")
load("render.star", "render")

def icon_widget(rows, palette):
    children = [render.Box(width = 16, height = 16, color = "#000")]
    for y, row in enumerate(rows):
        for x in range(len(row)):
            pixel = row[x]
            if pixel in palette:
                children.append(render.Padding(
                    pad = (x, y, 0, 0),
                    child = render.Box(width = 1, height = 1, color = palette[pixel]),
                ))
    return render.Stack(children = children)

def main(config):
    data = json.decode(config.get("payload_json") or "{}")
    display = data.get("display") or {}
    palette = display.get("palette") or {}
    frames = display.get("iconFrames") or [display.get("icon") or []]
    children = [render.Padding(
        pad = (3, 1, 0, 0),
        child = render.Animation(children = [icon_widget(rows, palette) for rows in frames]),
    )]
    children.extend([
        render.Padding(pad = (26, 1, 0, 0), child = render.Text(content = display.get("temp") or "--F", font = "6x13", color = "#F5F4ED")),
        render.Padding(pad = (3, 18, 0, 0), child = render.Text(content = display.get("summary") or "UNAVAILABLE", font = "tom-thumb", color = "#CBD5DF")),
        render.Padding(pad = (3, 25, 0, 0), child = render.Text(content = display.get("high") or "HI --", font = "tom-thumb", color = "#FFD15C")),
        render.Padding(pad = (35, 25, 0, 0), child = render.Text(content = display.get("low") or "LO --", font = "tom-thumb", color = "#65BFFF")),
    ])
    return render.Root(delay = display.get("animationDelayMs") or 250, show_full_animation = False, child = render.Stack(children = children))
