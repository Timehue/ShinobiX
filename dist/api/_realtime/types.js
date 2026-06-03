"use strict";
/**
 * Shared types + interface for the realtime online-state layer (Phase 2).
 *
 * The whole point of this layer is to hold live player presence in PROCESS
 * MEMORY on the single always-on Railway instance instead of writing
 * `presence:<name>` to the database on every 1s heartbeat. Every handler in the
 * Express process shares one store instance, so reads are instant and there is
 * zero per-second DB write.
 *
 * `MemoryOnlineStateStore` implements this interface now. When the app ever
 * needs more than one backend instance (Phase 9), a `RedisOnlineStateStore`
 * implements the SAME interface and consumers don't change.
 */
Object.defineProperty(exports, "__esModule", { value: true });
