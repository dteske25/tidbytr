load("encoding/json.star", "json")
load("render.star", "render")

def main(config):
    data = json.decode(config.get("payload_json") or "{}")
    display = data.get("display") or {}
    team = display.get("team") or "HOME"
    opponent = display.get("opponent") or "AWAY"
    team_score = display.get("teamScore") or "0"
    opponent_score = display.get("opponentScore") or "0"

    return render.Root(
        child = render.Stack(
            children = [
                render.Box(width = 64, height = 2, color = "#28f"),
                render.Padding(
                    pad = (2, 3, 0, 0),
                    child = render.Text(content = "FINAL", color = "#28f"),
                ),
                render.Padding(
                    pad = (2, 11, 0, 0),
                    child = render.Text(content = team[:5], color = "#fff"),
                ),
                render.Padding(
                    pad = (39, 11, 0, 0),
                    child = render.Text(content = opponent[:5], color = "#fff"),
                ),
                render.Padding(
                    pad = (6, 20, 0, 0),
                    child = render.Text(content = team_score, font = "6x13", color = "#fff"),
                ),
                render.Padding(
                    pad = (44, 20, 0, 0),
                    child = render.Text(content = opponent_score, font = "6x13", color = "#fff"),
                ),
                render.Padding(
                    pad = (29, 21, 0, 0),
                    child = render.Box(width = 6, height = 2, color = "#28f"),
                ),
            ],
        ),
    )

