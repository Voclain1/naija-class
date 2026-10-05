import { AppModule } from "./app.module";
import { CbtDeliveryAppModule } from "./cbt-delivery-app.module";

// API_MODE=cbt-delivery starts the exam-day service instead of the full API:
// the same image, only the public online-exam routes (docs/modules/cbt.md D9).
// Anything else — unset included — is the full API, as before.
export const rootModuleFor = (mode: string | undefined) => (mode === "cbt-delivery" ? CbtDeliveryAppModule : AppModule);
