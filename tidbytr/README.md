# Tidbytr

Tidbytr is a local display scheduler for a **Tidbyt Gen 2 running HDK community firmware**. It provides clock, NWS weather, and favorite-team sports screens with configurable priorities, minimum screen time, and repeat cooldowns.

## Install and start

1. In Home Assistant, open **Settings → Add-ons → Add-on Store → ⋮ → Repositories** (called Apps/App Store in some versions) and add `https://github.com/dteske25/tidbytr`.
2. Find **Tidbytr** and select **Install**. Supported hosts are **amd64** and **aarch64/arm64**; the first image build can take several minutes.
3. In **Configuration**, set `timezone`, your `latitude`/`longitude`, and a real `nws_contact`. Optionally set `favorite_teams`, such as `[KC]`.
4. Set `display_base_url` to the Home Assistant host's LAN address, for example `http://192.168.1.50:8788`, and keep the **8788/tcp** host-port mapping enabled. Replace the example IP with your host IP.
5. Save, start the add-on, and use **Open Web UI**. Optionally enable **Start on boot**.
6. From the same LAN, confirm `http://192.168.1.50:8788/current.webp` returns an image. Then configure HDK on the Gen 2 to poll that complete URL.

The dashboard uses Home Assistant Ingress; firmware uses the separate LAN WebP feed. An Ingress/Nabu Casa URL or `localhost` is not the firmware feed address. You do not need a Tidbyt API token or a separate Node.js/Pixlet installation on the HA host.

## Configure the Tidbyt

Stock production firmware does not consume this feed. Install/configure [HDK](https://github.com/tidbyt/hdk) using the **`tidbyt-gen2`** PlatformIO environment. Read HDK's flashing/support warning first; its maintainers state that custom flashing voids the warranty and can damage the device.

The [repository installation guide](https://github.com/dteske25/tidbytr#3-point-the-tidbyt-at-the-feed) contains the full configuration example, flashing command, and troubleshooting steps. Wi-Fi credentials and the remote URL are compiled into the HDK firmware.

## Confirm it works

**Last pull** in the dashboard should update when the device polls. Tune **Screen priorities**, or try **Show for 1 minute**, **Skip**, and **Snooze**. Dashboard previews are separate from the published image and do not count as device pulls.

Runtime state persists under `/data`. Dashboard/API saves override the initial HA options on restart; see the [configuration ownership documentation](https://github.com/dteske25/tidbytr/blob/main/tidbytr/DOCS.md#configuration-ownership) before changing saved settings.

Tidbytr currently exposes status/actions in its dashboard and does not create Home Assistant entities. See [the add-on documentation](https://github.com/dteske25/tidbytr/blob/main/tidbytr/DOCS.md) for detailed behavior and API options.
