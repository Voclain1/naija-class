import { Body, Controller, Get, HttpCode, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  voiceEndSchema,
  voiceInterruptSchema,
  voiceSessionCreateSchema,
  voiceSpeechSchema,
  voiceTurnSchema,
  type VoiceCapabilitiesDto,
  type VoiceCredentialDto,
  type VoiceInterruptInput,
  type VoiceSessionCreateInput,
  type VoiceSessionDto,
  type VoiceSessionStartDto,
  type VoiceSpeechInput,
  type VoiceTurnDto,
  type VoiceTurnInput,
} from "@school-kit/types";
import type { Request, Response } from "express";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { AssistantVoiceService } from "./assistant-voice.service.js";

// SchoolKit Assistant voice (docs/modules/assistant-voice.md, "Endpoints").
// Every route needs a signed-in staff session; school and user come from it,
// never from a body or a path. Transcripts and replies travel in POST bodies
// only, never URLs. Nothing here can approve a write.
@Controller("assistant/voice")
@UseGuards(AuthGuard)
export class AssistantVoiceController {
  constructor(private readonly voice: AssistantVoiceService) {}

  @Get("capabilities")
  capabilities(@CurrentUser() auth: AuthContext): Promise<VoiceCapabilitiesDto> {
    return this.voice.capabilities(auth);
  }

  @Post("sessions")
  @HttpCode(201)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  start(@CurrentUser() auth: AuthContext, @Body(new ZodValidationPipe(voiceSessionCreateSchema)) body: VoiceSessionCreateInput): Promise<VoiceSessionStartDto> {
    return this.voice.start(auth, body);
  }

  @Get("sessions/:sessionId")
  get(@CurrentUser() auth: AuthContext, @Param("sessionId") sessionId: string): Promise<VoiceSessionDto> {
    return this.voice.get(auth, sessionId);
  }

  @Post("sessions/:sessionId/credentials")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  credentials(@CurrentUser() auth: AuthContext, @Param("sessionId") sessionId: string): Promise<{ session: VoiceSessionDto; credential: VoiceCredentialDto }> {
    return this.voice.credentials(auth, sessionId);
  }

  @Post("sessions/:sessionId/heartbeat")
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  heartbeat(@CurrentUser() auth: AuthContext, @Param("sessionId") sessionId: string): Promise<VoiceSessionDto> {
    return this.voice.heartbeat(auth, sessionId);
  }

  @Post("sessions/:sessionId/turns")
  @HttpCode(200)
  // Same per-person rate as the chat's turn endpoint: voice is not a way round it.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  turn(@CurrentUser() auth: AuthContext, @Param("sessionId") sessionId: string, @Body(new ZodValidationPipe(voiceTurnSchema)) body: VoiceTurnInput): Promise<VoiceTurnDto> {
    return this.voice.turn(auth, sessionId, body);
  }

  /**
   * Streams the spoken reply. The browser aborting the request (barge-in,
   * End, navigation) stops the provider stream. Errors before the first byte
   * use the standard JSON error shape; after it, the stream simply ends.
   */
  @Post("sessions/:sessionId/speech")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async speech(
    @CurrentUser() auth: AuthContext,
    @Param("sessionId") sessionId: string,
    @Body(new ZodValidationPipe(voiceSpeechSchema)) body: VoiceSpeechInput,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.on("close", onClose);
    res.on("close", onClose);
    const stream = await this.voice.speech(auth, sessionId, body, controller.signal);
    res.status(200);
    res.setHeader("Content-Type", stream.contentType);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Voice-Speech-Chars", String(stream.characters));
    try {
      for await (const chunk of stream.body) {
        if (controller.signal.aborted) break;
        res.write(chunk);
      }
    } catch {
      // Aborted or the provider dropped mid-stream: end what was sent.
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

  @Post("sessions/:sessionId/interrupt")
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  interrupt(@CurrentUser() auth: AuthContext, @Param("sessionId") sessionId: string, @Body(new ZodValidationPipe(voiceInterruptSchema)) body: VoiceInterruptInput): Promise<VoiceSessionDto> {
    return this.voice.interrupt(auth, sessionId, body);
  }

  @Post("sessions/:sessionId/end")
  @HttpCode(200)
  end(@CurrentUser() auth: AuthContext, @Param("sessionId") sessionId: string, @Body(new ZodValidationPipe(voiceEndSchema)) _body: unknown): Promise<VoiceSessionDto> {
    return this.voice.end(auth, sessionId);
  }
}
