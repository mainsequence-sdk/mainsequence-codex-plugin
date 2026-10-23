# Local development backend

For the shared Mac/workstation Django proxy, save these existing workspace
preferences through `mainsequence_settings`:

```json
{
  "action": "save",
  "backend": "http://local-backend:8000",
  "baseDir": "/Users/jose/mainsequence-dev",
  "commandCenterUrl": ""
}
```

Settings saves replace the full preference object, so retain the current
repositories folder and optional Command Center URL. This workstation setup
uses the values above. No plugin rebuild or new hardcoded backend is required.

Map `local-backend` to the machine serving the development Django stack with
that stack's `maintenance/switch_local_backend.py` after a stack switch. Refresh
the plugin context afterwards. The installed plugin reads these shared devtools
preferences; source and published packages keep their normal backend-selection
behavior. Historical verification notes retain the addresses actually tested.

Login and saved connections are backend scoped. Use the existing settings login
flow if this hostname has no saved session, and rediscover/reconnect project MCPs
against the selected backend as needed. Never copy tokens or modify credential
storage to migrate a hostname.
