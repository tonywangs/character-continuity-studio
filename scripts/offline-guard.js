// Verification-only guard. Denies Node socket/DNS access, including fetch, in
// isolated package workflows. This is not an operating-system network sandbox.
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';
const denied = () => { throw new Error('Network access forbidden during offline verification'); };
net.connect = denied; net.createConnection = denied; net.Socket.prototype.connect = denied;
net.Server.prototype.listen = denied; tls.connect = denied;
http.request = denied; http.get = denied; https.request = denied; https.get = denied;
http.Server.prototype.listen = denied; https.Server.prototype.listen = denied; dgram.createSocket = denied;
for (const object of [dns, dnsPromises]) for (const key of Object.keys(object)) if (/^(lookup|resolve|reverse)/.test(key)) object[key] = denied;
globalThis.fetch = denied;
syncBuiltinESMExports();
