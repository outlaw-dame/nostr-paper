# Nostr Zone Presence and Gateway Events (Custom Kind 30078 Profile)

Status: Draft profile for app-level interoperability

## Scope

This document defines a concrete profile for custom Nostr application events carried in kind 30078 (NIP-78 Application-specific Data).

It covers these payload types:
- zone_presence
- gateway_grant_request
- device_gateway_grant_request
- swarm_device_record

## Normative Base

- Event kind: 30078
- Base standard: NIP-78 (Application-specific Data)
- Interop note: Payload fields below are app conventions, not NIP-registered schemas.

## Event Envelope

All events in this profile SHOULD use:
- kind: 30078
- tags include one d tag for profile namespace/version

Recommended d tag values:
- d = zone-presence:v1
- d = gateway-grant-request:v1
- d = device-gateway-grant-request:v1
- d = swarm-device-record:v1

Optional coordination tags:
- p: target pubkey
- e: related event id
- t: classification tags

## JSON Content Contract

The event content SHOULD be valid JSON object text.

Common fields:
- type: string, one of the profile type values
- ts: unix timestamp seconds
- requestId: string for request/response flow correlation
- version: integer schema version (recommended 1)

### 1) zone_presence

Purpose: publish gateway or node health snapshot.

Required:
- type = "zone_presence"

Recommended:
- role: "gateway" | "node" | "edge" | custom string
- zoneId: string
- metrics: object
  - cpuPct: number
  - memPct: number
  - tempC: number
- status: "online" | "degraded" | "offline" | custom

Example:

{
  "type": "zone_presence",
  "version": 1,
  "ts": 1710000000,
  "role": "gateway",
  "zoneId": "home-west",
  "status": "online",
  "metrics": { "cpuPct": 1.9, "memPct": 22.1 }
}

### 2) gateway_grant_request

Purpose: request access grant from gateway controller.

Required:
- type = "gateway_grant_request"
- requestId: string

Recommended:
- fromDevicePk: hex pubkey string
- requestedScopes: string[]
- expiresAt: unix timestamp seconds
- reason: string

Example:

{
  "type": "gateway_grant_request",
  "version": 1,
  "ts": 1710000010,
  "requestId": "gw-grant-9377a145e08cd6cc8c68f6c0",
  "fromDevicePk": "<hex-pubkey>",
  "requestedScopes": ["camera:read", "camera:stream"],
  "expiresAt": 1710003610
}

### 3) device_gateway_grant_request

Purpose: device-side request or status update for gateway grant workflow.

Required:
- type = "device_gateway_grant_request"
- requestId: string

Recommended:
- toDevicePk: hex pubkey string
- grantStatus: "pending" | "approved" | "denied" | "expired"
- statusMessage: string

Example:

{
  "type": "device_gateway_grant_request",
  "version": 1,
  "ts": 1710000020,
  "requestId": "gw-grant-c3328fe7da20ae3ffacc5ace",
  "toDevicePk": "<hex-pubkey>",
  "grantStatus": "approved"
}

### 4) swarm_device_record

Purpose: publish a durable record for a device in swarm inventory.

Required:
- type = "swarm_device_record"

Recommended:
- deviceId: string
- deviceName: string
- status: "online" | "offline" | "sleep" | custom
- capabilities: string[]
- lastSeenAt: unix timestamp seconds
- firmware: string

Example:

{
  "type": "swarm_device_record",
  "version": 1,
  "ts": 1710000030,
  "deviceId": "garage-cam-2",
  "deviceName": "Garage Camera 2",
  "status": "online",
  "capabilities": ["camera", "night-vision"],
  "lastSeenAt": 1710000030,
  "firmware": "1.4.2"
}

## Parsing Robustness Rules

Consumers SHOULD normalize type values before matching:
- lowercase
- map spaces and hyphens to underscores

Examples that normalize to device_gateway_grant_request:
- "Device gateway grant request"
- "device-gateway-grant-request"
- "device_gateway_grant_request"

## Security and Privacy

- Do not include raw secrets or private keys in content.
- Use scoped IDs rather than sensitive internal hostnames where possible.
- Consider encrypting sensitive workflows via NIP-44 where needed.

## Relationship to NIP-90

For marketplace-style request/response services, NIP-90 kinds (5000-7000) may be a better fit.
This profile is intentionally lightweight and state-oriented for app-specific data in NIP-78.
