# Friction log

Kept while building Standup Voice for the Alexa+ track of *Build, Ship, Shape: Amazon Developer Hackathon*.

| # | Task attempted | Steps taken | Expected | Actual | Severity | Workaround | Suggestion |
|---|---|---|---|---|---|---|---|
| 1 | Enable Bee Developer Mode | Installed the Bee app, looked for Developer Mode, read the FAQ | A demo account or sample data, so we could build without hardware | Requires a paired Bee Pioneer device; the app has no skip | Critical (blocked the Bee track) | Moved to the Alexa+ track and kept the shared extraction pipeline | Offer a sandbox account with recorded conversations |
| 2 | Test our MCP server against Alexa+ | Searched the track docs and resources for a test client | A simulator, or a way to register a dev MCP endpoint with Alexa+ | Nothing available to hackathon entrants | High | Built our own simulated Alexa+ web app that acts as a real MCP client | Publish an Alexa+ MCP test console that shows tool selection and the spoken result |
| 3 | Serve Streamable HTTP with MCP TypeScript SDK v2 | README, then each package's docs (`server`, `node`, `client`) | One end-to-end example wiring `McpServer` to Node HTTP | Examples are spread across packages, and v1 snippets no longer compile | Medium | Read the SDK source | Add one complete v2 Streamable HTTP example (server + client) |
| 4 | Call Claude on Amazon Bedrock | Configured the AWS CLI profile, invoked the model with `@anthropic-ai/bedrock-sdk` | Model access, or an error that names the fix | `AccessDenied` for our IAM user; the model-access flow was unclear | Medium | Anthropic API path plus an offline intent router | Make "request model access" one step that also shows the required IAM policy |
| 5 | Show finished work from feature branches | GitHub commit search for the user's commits | Commits from all branches | Search only indexes default branches | Low | Count merged and open PRs instead | (GitHub) Document this limit in the search API reference |
