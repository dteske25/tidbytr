load("encoding/json.star", "json")
load("render.star", "render")

def main(config):
    data = json.decode(config.get("payload_json") or "{}")
    forecast = data.get("payload") or {}
    temp = str(forecast.get("temperature") or "--") + "F"
    high = forecast.get("high") or "-"
    low = forecast.get("low") or "-"
    summary = forecast.get("shortForecast") or "Forecast unavailable"

    return render.Root(
        child = render.Stack(
            children = [
                render.Padding(
                    pad = (5, 5, 0, 0),
                    child = render.Circle(diameter = 10, color = "#fc0"),
                ),
                render.Padding(
                    pad = (12, 16, 0, 0),
                    child = render.Box(width = 20, height = 5, color = "#eef"),
                ),
                render.Padding(
                    pad = (31, 4, 0, 0),
                    child = render.Text(content = temp, font = "6x13", color = "#fff"),
                ),
                render.Padding(
                    pad = (34, 18, 0, 0),
                    child = render.Text(content = "H%s L%s" % (high, low), color = "#999"),
                ),
                render.Padding(
                    pad = (3, 25, 0, 0),
                    child = render.WrappedText(
                        content = summary,
                        width = 58,
                        height = 7,
                        color = "#28f",
                    ),
                ),
            ],
        ),
    )

