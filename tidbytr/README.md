# Tidbytr Home Assistant add-on

Tidbytr delivers a custom clock/weather/sports app through the Tidbyt API to stock Gen 2 firmware. Keep Store apps in rotation. Custom firmware and a LAN display listener are no longer required.

Install/update this add-on, enter `tidbyt_api_token` and `tidbyt_device_id` from device settings in the Tidbyt mobile app, set timezone/location and `nws_contact`, then start and open the Web UI. Keep `installation_id: tidbytrmain` to update one app. Regular updates run in the background; Show now and critical alerts request immediate display.

For upgrades from HDK, back up the add-on, restore production firmware using [HDK's Back to Normal instructions](https://github.com/tidbyt/hdk#back-to-normal) for Gen 2, then configure API delivery. Remove obsolete `display_base_url` and port 8788 settings. This add-on does not flash firmware.

See the [installation guide](https://github.com/dteske25/tidbytr#readme) and [operations documentation](DOCS.md). API acceptance does not confirm physical display; outages can leave previous images on the device.
