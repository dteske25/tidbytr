load("encoding/json.star", "json")
load("render.star", "render")

def main(config):
    data = json.decode(config.get("payload_json") or "{}")
    display = data.get("display") or {}
    day = display.get("day") or ""
    return render.Root(child = render.Stack(children = [
        render.Box(width = 64, height = 2, color = "#fc0"),
        render.Padding(pad = (2, 4, 0, 0), child = render.Text(content = display.get("header") or "NEXT", font = "tom-thumb", color = "#fc0")),
        render.Padding(pad = (34, 4, 0, 0), child = render.Text(content = day, font = "tom-thumb", color = "#CBD5DF")),
        render.Padding(pad = (0, 11, 0, 0), child = render.Box(width = 64, height = 8, child = render.Text(content = display.get("matchup") or "HOME VS AWAY", font = "tom-thumb", color = "#fff"))),
        render.Padding(pad = (0, 18, 0, 0), child = render.Box(width = 64, height = 14, child = render.Text(content = display.get("time") or "TBD", font = "6x13", color = "#fff"))),
    ]))
