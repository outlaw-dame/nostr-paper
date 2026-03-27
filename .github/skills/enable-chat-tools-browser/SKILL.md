---
name: enable-chat-tools-browser
description: 'Enable or disable VS Code Chat Tools in Browser by configuring workbench.browser.enableChatTools. Use for browser tool availability issues, setup requests, policy-driven toggles, workspace vs user scope decisions, and validation/troubleshooting after changing the setting.'
argument-hint: 'scope=<workspace|user> value=<true|false> verify=<true|false>'
---

# Enable Chat Tools In Browser

Configure the VS Code setting `workbench.browser.enableChatTools` so chat tools are available (or intentionally disabled) in the integrated browser context.

## When To Use
- You want to enable browser chat tools quickly.
- Chat tools are missing in browser-based chat workflows.
- You need a repeatable setup for team onboarding.
- You need to enforce workspace-level behavior in source control.
- You need to disable the feature for policy/compliance reasons.

## Inputs
- `scope`: `workspace` or `user` (default `workspace`)
- `value`: `true` or `false`
- `verify`: `true` or `false` (default `true`)

## Invocation Behavior
- Slash command remains visible for manual invocation.
- Model auto-loading remains enabled when prompts match this skill's description.

## Decision Guide
1. Choose `workspace` if the whole project should share the setting.
2. Choose `user` if this is only for your local environment.
3. Choose `value=true` to enable browser chat tools.
4. Choose `value=false` to intentionally disable.

## Procedure
1. Determine target file by scope:
- `workspace` -> `.vscode/settings.json`
- `user` -> VS Code User Settings (JSON)

2. Open the settings JSON for the chosen scope.

3. Add or update this property:

```json
{
  "workbench.browser.enableChatTools": true
}
```

4. If the JSON already contains the property, replace only its value.

5. If `verify=true`, validate behavior:
- Open the integrated browser and chat panel.
- Confirm chat tools are available when `true`.
- If `false`, confirm tools are hidden/disabled as expected.

6. If verification fails, run troubleshooting:
- Reload window (`Developer: Reload Window`).
- Confirm there is no conflicting scope override.
- Check the setting in both User and Workspace scopes.
- Ensure the VS Code version and Copilot Chat extension are current.

## Completion Criteria
- Target scope contains `workbench.browser.enableChatTools` with intended boolean value.
- No JSON syntax errors in settings file.
- Verification outcome matches intended behavior.

## Example Prompts
- `/enable-chat-tools-browser scope=workspace value=true verify=true`
- `/enable-chat-tools-browser scope=user value=true verify=true`
- `/enable-chat-tools-browser scope=workspace value=false verify=false`

## Notes
- Prefer workspace scope for team-shared behavior.
- Prefer user scope for personal experimentation.
- If both scopes set the value, workspace scope can override in that project.
