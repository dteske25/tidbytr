# Tidbytr

Tidbytr is a local display server for a **Tidbyt Gen 2 running HDK firmware**, with a Home Assistant add-on and a web dashboard. It shows a clock, U.S. National Weather Service forecasts/alerts, and favorite-team sports scores.

Screens respond to priorities and changes rather than following a fixed rotation. Critical weather alerts can interrupt, changed scores earn screen time, and cooldowns limit repeated content. The dashboard lets you adjust priorities, minimum screen time, and repeat intervals.

## What you need

- A Tidbyt Gen 2 and a data-capable USB cable for installing HDK firmware.
- Home Assistant with the add-on store, normally Home Assistant OS, on **amd64 or aarch64/arm64**. Home Assistant Container/Core do not include the add-on store.
- A LAN connection between the Tidbyt and the Home Assistant host. Internet access supplies weather and sports data.
- A computer with Git and [PlatformIO Core](https://docs.platformio.org/en/latest/core/installation/index.html) for flashing HDK.

Tidbytr's local feed requires [HDK community firmware](https://github.com/tidbyt/hdk); the stock production firmware does not poll this URL. Read HDK's flashing and support warning before proceeding: its maintainers state that flashing custom firmware voids the warranty and can damage the device. This setup replaces the production firmware's Store-app display flow.

You do not need a Tidbyt API token. The add-on includes Node.js and Pixlet; you do not need to install them separately on the Home Assistant host.

## 1. Install the Home Assistant add-on

1. Open **Settings → Add-ons → Add-on Store** in Home Assistant. Some versions label these **Apps** and **App Store**.
2. Open the store's **⋮ → Repositories** menu and add:

   ```text
   https://github.com/dteske25/tidbytr
   ```

3. Close the repository dialog and find **Tidbytr** in the store. Refresh the store if it has not appeared yet.
4. Open **Tidbytr → Install**. The add-on builds its image from the bundled source, so the first installation can take several minutes.

## 2. Configure and start it

Before starting, open the add-on's **Configuration** tab and set your timezone, location, NWS contact, and display URL. For example:

```yaml
display_base_url: "http://192.168.1.50:8788"
timezone: "America/Chicago"
latitude: 39.0997
longitude: -94.5786
nws_contact: "Tidbytr (you@example.com)"
favorite_teams:
  - KC
log_level: info
scheduler_interval_seconds: 60
refresh_interval_seconds: 600
quiet_hours_start: ""
quiet_hours_end: ""
```

Replace `192.168.1.50` with **your Home Assistant host's LAN IP**, replace the example coordinates with your location, and use a real contact address. `favorite_teams` accepts abbreviations or full team names from the NFL, NBA, MLB, and NHL; use `[]` to disable sports. Leave both quiet-hours values empty to disable quiet hours, or set a window such as `22:00` and `06:00`.

Keep the add-on's **Network** mapping for `8788/tcp` enabled on host port **8788**. If you choose another host port, use that port in both `display_base_url` and the firmware URL below. Reserving the Home Assistant host's IP in your router keeps this address stable.

Save the options, enable **Start on boot** if desired, and click **Start**. Use **Open Web UI** to open the dashboard through Home Assistant Ingress.

From another device on the same LAN, open this URL, substituting your host IP:

```text
http://192.168.1.50:8788/current.webp
```

It should return a 64×32 WebP image. A clock is available while providers initialize or when external data is unavailable. Confirm this feed works before flashing the Tidbyt.

## 3. Point the Tidbyt at the feed

Connect the Gen 2 to your computer with the USB data cable. Follow [HDK's setup instructions](https://github.com/tidbyt/hdk#setup) for PlatformIO and any platform-specific USB/driver requirements.

In a Bash-compatible terminal on your computer:

```bash
git clone https://github.com/tidbyt/hdk.git
cd hdk

TIDBYT_WIFI_SSID='Your WiFi' \
TIDBYT_WIFI_PASSWORD='Your WiFi password' \
TIDBYT_REMOTE_URL='http://192.168.1.50:8788/current.webp' \
pio run --environment tidbyt-gen2 --target upload
```

Replace the Wi-Fi values and host IP. Use the **`tidbyt-gen2`** environment for Gen 2 hardware. The remote URL includes `/current.webp`; the add-on's `display_base_url` option does not.

The URL must be reachable directly from the Tidbyt. Use the LAN feed, **not** a Home Assistant Ingress URL, a Nabu Casa URL, `localhost`, or a container-only hostname. If HDK is already installed, configure/rebuild it with this remote URL using your existing HDK setup.

Once running, the firmware polls the feed. Firmware settings and the current animation determine when a published screen becomes visible. HDK configuration is built into the firmware; changing its Wi-Fi credentials or remote URL requires updating/reflashing that configuration.

## 4. Verify and tune the screens

Open the Tidbytr dashboard and check:

- **Published screen** shows the current published image. **Selected preview** is a separate preview for choosing an action.
- **Last pull** updates and the status changes to **Tidbyt is polling** once the device requests the feed. Opening the dashboard preview does not count as a device pull.
- **Source health** shows weather/sports results. An empty favorite-team list disables sports.
- **Screen priorities → Save screen rules** adjusts priorities, minimum screen time, and cooldowns. **Show for 1 minute**, **Skip**, and **Snooze** apply immediately; critical alerts may interrupt a manual hold or snooze.

Dashboard/API settings persist across restarts and override the initial add-on options after a save. See [configuration ownership](tidbytr/DOCS.md#configuration-ownership) before changing an existing installation's settings.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Tidbytr is missing from the store | Confirm the repository URL, refresh the store, and check that the host is amd64 or aarch64/arm64 with add-on support. |
| Installation or startup fails | Open the add-on **Log** tab for the build/startup error. |
| The LAN WebP URL does not open | Confirm the add-on is running, the host IP and port mapping are correct, and the LAN/firewall permits the Tidbyt to reach TCP port 8788. |
| The feed works in a browser, but the Tidbyt is not polling | Check HDK's compiled Wi-Fi settings and full remote URL. From the HDK checkout, use `pio device monitor` to inspect device logs. |
| Weather or sports is degraded | Check Internet access, your NWS contact/location, and favorite-team names. NWS weather coverage is for the United States. Clock remains available when data expires. |
| An action changes the published image before the device changes | Allow for firmware polling and animation completion. A recorded pull confirms a request, not successful physical display. |

To return to production firmware, follow [HDK's Back to Normal instructions](https://github.com/tidbyt/hdk#back-to-normal) for Gen 2.

## More information

- [Add-on documentation](tidbytr/DOCS.md): refresh/freshness rules, control API, persistent configuration, and building releases.
- [Changelog](tidbytr/CHANGELOG.md).
- [Reliability review and implementation notes](docs/review/implementation-0.5.md): software verification and remaining physical-device validation.

Tidbytr currently manages status and controls in its dashboard; it does not create Home Assistant entities. Physical Gen 2 recovery and interruption behavior still need device validation before claiming greater reliability than Store apps.
