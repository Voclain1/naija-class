import { Injectable } from "@nestjs/common";
import { generateSecret, generateURI, verifySync } from "otplib";

// Thin wrapper around otplib v13 TOTP functions.
// All state lives in the DB (totp_secret / totp_pending_secret); this
// service is stateless and has no DI dependencies.
//
// Window: ±1 step (30s grace on either side of the current window), set
// explicitly as `epochTolerance: 30`. otplib v13's own default is 0, so a
// code typed in the last second of its window failed once the server's
// clock crossed into the next one (and so, now and then, did the CI test
// that generates a code and verifies it a few milliseconds later). This
// tolerates that and minor clock skew between the server and the user's
// authenticator app without widening the attack surface.
@Injectable()
export class TotpService {
  generateSecret(): string {
    return generateSecret();
  }

  getOtpAuthUrl(secret: string, label: string): string {
    return generateURI({ label, issuer: "School Kit", secret });
  }

  verifyCode(secret: string, code: string): boolean {
    try {
      const result = verifySync({ token: code, secret, epochTolerance: 30 });
      return result.valid;
    } catch {
      return false;
    }
  }
}
