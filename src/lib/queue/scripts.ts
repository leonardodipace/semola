export const CLAIM_JOB =
  "local payload = redis.call('RPOP', KEYS[1]) if not payload then return false end redis.call('ZADD', KEYS[2], ARGV[1], payload) return payload";

export const SCHEDULE_RETRY =
  "redis.call('ZREM', KEYS[1], ARGV[1]) redis.call('ZADD', KEYS[2], ARGV[3], ARGV[2]) return 1";

export const RELEASE_JOB =
  "redis.call('ZREM', KEYS[1], ARGV[1]) redis.call('RPUSH', KEYS[2], ARGV[1]) return 1";

export const PROMOTE_RETRIES =
  "local now = tonumber(ARGV[1]) local limit = tonumber(ARGV[2]) local members = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now, 'LIMIT', 0, limit) for i = 1, #members do redis.call('RPUSH', KEYS[2], members[i]) redis.call('ZREM', KEYS[1], members[i]) end return #members";

export const RECLAIM_INFLIGHT =
  "local now = tonumber(ARGV[1]) local limit = tonumber(ARGV[2]) local members = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now, 'LIMIT', 0, limit) for i = 1, #members do redis.call('RPUSH', KEYS[2], members[i]) redis.call('ZREM', KEYS[1], members[i]) end return #members";
