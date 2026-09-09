# Windshift

The `windshift` trigger files a [windshift](https://windshiftapp.com) work item when a watched container has a new version.

It is deliberately narrow: it files an item for **minor and major semver tag bumps only**. Patch bumps, prereleases, digest-only updates and tags that are not semver are ignored, so the tracker collects the updates worth a decision instead of every rebuild.

Before creating an item, the trigger searches the workspace for an item that is still open and already carries the update's marker (`wud:{watcher}:{container}:{target tag}`, appended to the item description). It creates nothing when it finds one, so the same update is filed once, however often the trigger runs. The marker is matched as a whole token, so the item of `1.2.10` never answers for `1.2.1`; a name or tag carrying a character the marker does not use is normalised and given a short digest of its original value, so two names that normalise alike keep distinct markers.

#### Variables

| Env var                                             |    Required    | Description                                                    | Supported values             | Default value when missing |
|-----------------------------------------------------|:--------------:|----------------------------------------------------------------|------------------------------|----------------------------|
| `WUD_TRIGGER_WINDSHIFT_{trigger_name}_URL`          |  :red_circle:  | The base url of the windshift instance (without the api path)  | Valid http or https endpoint |                            |
| `WUD_TRIGGER_WINDSHIFT_{trigger_name}_TOKEN`        |  :red_circle:  | The api token used to create the items                         | A windshift api token        |                            |
| `WUD_TRIGGER_WINDSHIFT_{trigger_name}_WORKSPACE`    |  :red_circle:  | The id of the workspace the items are created in               | Integer                      |                            |
| `WUD_TRIGGER_WINDSHIFT_{trigger_name}_ITEMTYPE`     | :white_circle: | The id of the item type to create                              | Integer                      | `4`                        |
| `WUD_TRIGGER_WINDSHIFT_{trigger_name}_PRIORITY`     | :white_circle: | The id of the priority to create the items with                | Integer                      | `3`                        |

?> This trigger also supports the [common configuration variables](configuration/triggers/?id=common-trigger-configuration).

?> The token is only ever sent as an `Authorization: Bearer` header and is masked in the logs. It can be provided from a file with `WUD_TRIGGER_WINDSHIFT_{trigger_name}_TOKEN__FILE`.

#### Recommended: `ONCE=false`

`WUD_TRIGGER_WINDSHIFT_{trigger_name}_ONCE=false` runs the trigger on every scan while the update is pending, instead of only on the scan that discovered it.

That is the reliable setting here, because the search above is what stops a second item from being filed. With the default `ONCE=true`, an item that could not be created — windshift unreachable, the token rejected, the instance restarting — is never attempted again; with `ONCE=false` the next scan tries again and, once the item exists, finds it and does nothing.

### Examples

#### File the minor and major updates of every container

<!-- tabs:start -->
#### **Docker Compose**
```yaml
services:
  whatsupdocker:
    image: getwud/wud
    ...
    environment:
      - WUD_TRIGGER_WINDSHIFT_TRACKER_URL=https://windshift.example.com
      - WUD_TRIGGER_WINDSHIFT_TRACKER_TOKEN=crw_my_api_token
      - WUD_TRIGGER_WINDSHIFT_TRACKER_WORKSPACE=3
      - WUD_TRIGGER_WINDSHIFT_TRACKER_ONCE=false
```
#### **Docker**
```bash
docker run \
  -e WUD_TRIGGER_WINDSHIFT_TRACKER_URL="https://windshift.example.com" \
  -e WUD_TRIGGER_WINDSHIFT_TRACKER_TOKEN="crw_my_api_token" \
  -e WUD_TRIGGER_WINDSHIFT_TRACKER_WORKSPACE="3" \
  -e WUD_TRIGGER_WINDSHIFT_TRACKER_ONCE="false" \
  ...
  getwud/wud
```
<!-- tabs:end -->

#### Example of created item

The trigger posts the rendered title and body to the windshift item api; the marker is appended to the description.

```json
{
  "title": "New tag found for container homeassistant",
  "description": "Container homeassistant running with tag 2021.6.4 can be updated to tag 2021.7.0\n\nwud:local:homeassistant:2021.7.0",
  "workspace_id": 3,
  "item_type_id": 4,
  "priority_id": 3
}
```
