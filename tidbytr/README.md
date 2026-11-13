# Tidbytr Home Assistant add-on

Tidbytr delivers a custom clock/weather/sports app through the Tidbyt API to stock Gen 2 firmware. Keep Store apps in rotation. Custom firmware and a LAN display listener are no longer required.

Install/update this add-on, enter `tidbyt_api_token` and `tidbyt_device_id` from device settings in the Tidbyt mobile app, set timezone/location and `nws_contact`, then start and open the Web UI. Keep `installation_id: tidbytrmain` to update one app. Regular updates run in the background; Show now and critical alerts request immediate display.

For upgrades from HDK, back up the add-on, restore production firmware using [HDK's Back to Normal instructions](https://github.com/tidbyt/hdk#back-to-normal) for Gen 2, then configure API delivery. Remove obsolete `display_base_url` and port 8788 settings. This add-on does not flash firmware.

See the [installation guide](https://github.com/dteske25/tidbytr#readme) and [operations documentation](DOCS.md). API acceptance does not confirm physical display; outages can leave previous images on the device.

Version 0.7 adds a 12-hour clock, configurable baby age, and animated Star flight. Use Personal screens in the dashboard, or initial HA options `baby_birth_date`, `baby_name`, and `starfield_enabled`. Baby age stays hidden until a valid birth date is configured.

Version 0.8 defaults to clock-led rotation: Clock 60s → Weather 20s → Clock 60s → Baby age 20s → Clock 60s → Stars 20s. Adjust Rotation in the dashboard. For closest physical timing, keep only Tidbytr enabled in the device app rotation. Priority mode retains the earlier background scheduling behavior.
