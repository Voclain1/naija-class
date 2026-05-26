import { Injectable } from "@nestjs/common";

import { StorageService } from "../../common/storage";

// Skeleton service for cp1. The real surface — upload, applyMapping,
// getJob, deleteJob, badRowsCsv — lands in cp2 (endpoints) and cp3
// (worker logic). Holding the constructor wiring here so DI graph
// validation runs at boot in cp1, surfacing any provider/import
// mistakes immediately rather than at the first cp2 endpoint call.
@Injectable()
export class ImportsService {
  constructor(private readonly storage: StorageService) {}

  // Returned by the cp1 health check so we can confirm at boot that
  // (a) ImportsModule resolved, (b) StorageModule was injected, and
  // (c) the configured driver kind matches env. Not exposed beyond
  // cp1 — cp2 removes this in favour of real endpoints.
  describeWiring(): { storageDriver: string } {
    return { storageDriver: this.storage.driverKind };
  }
}
