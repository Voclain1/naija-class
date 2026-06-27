import { Injectable } from "@nestjs/common";
import { generateSecret, generateSync, generateURI, verifySync } from "otplib";

// Thin wrapper around otplib v13 TOTP functions.
// All state lives in the DB (totp_secret / totp_pending_secret); this
// service is stateless and has no DI dependencies.
//
// Window: otplib defaults to ±1 step (30s grace on either side of the
// current window). This tolerates minor clock skew between the server
// and the user's authenticator app without widening the attack surface.
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
      const result = verifySync({ token: code, secret });
      return result.valid;
    } catch {
      return false;
    }
  }
}
