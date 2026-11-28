# Local development backend

To point the plugin at a development backend, save these existing workspace
preferences through `mainsequence_settings`:

```json
{
  "action": "save",
  "backend": "http://dev-backend.test:8000",
  "baseDir": "~/mainsequence-dev",
  "commandCenterUrl": ""
}
```

Settings saves replace the full preference object, so retain the current
repositories folder and optional Command Center URL. Replace the example values
with your own. No plugin rebuild or new hardcoded backend is required.

Map a hostname such as `dev-backend.test` to the machine serving the development
backend, for example in `/etc/hosts`, and update it when that machine changes.
Refresh the plugin context afterwards. The installed plugin reads these shared
devtools preferences; source and published packages keep their normal
backend-selection behavior.

Login and saved connections are backend scoped. Use the existing settings login
flow if this hostname has no saved session, and rediscover/reconnect project MCPs
against the selected backend as needed. Never copy tokens or modify credential
storage to migrate a hostname.
