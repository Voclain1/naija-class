import { BullModule } from "@nestjs/bullmq";
import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";

// Global queue module. Connects BullMQ to the Redis URL from env and
// re-exports BullModule so any feature module can call
// BullModule.registerQueue('<name>') without re-wiring the connection.
//
// Connection config is derived from REDIS_URL (already documented in
// .env.example since Phase 0; the var has been present but unused
// until slice 6). maxRetriesPerRequest must be null for BullMQ —
// BullMQ uses blocking commands which ioredis refuses to retry on a
// closed connection unless this is set; the ioredis docs note this
// explicitly and BullMQ throws on startup without it.
//
// We pass `connection` as a plain options object rather than a shared
// IORedis instance so BullMQ can create one connection per queue /
// worker as the docs recommend. That isolates a stuck worker
// connection from the producers in the API request path.

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>("REDIS_URL") ?? "redis://localhost:6379";
        const parsed = new URL(url);
        return {
          connection: {
            host: parsed.hostname,
            port: parsed.port ? Number(parsed.port) : 6379,
            username: parsed.username || undefined,
            password: parsed.password || undefined,
            db: parsed.pathname && parsed.pathname.length > 1
              ? Number(parsed.pathname.slice(1))
              : 0,
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
