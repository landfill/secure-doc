export interface PublishHistoryRecord {
  documentId: string;
  title: string;
  issuer: string;
  issuedAt: string;
  displayExpiresAt?: string;
  packageSha256: string;
  kdf: "PBKDF2-HMAC-SHA-256";
  iterations: number;
  contentAlg: "AES-256-GCM";
  createdBy: string;
  outputPath: string;
  platform: string;
}

export interface SavePackageRequest {
  suggestedFileName: string;
  html: string;
  history: Omit<PublishHistoryRecord, "packageSha256" | "outputPath" | "platform">;
}

export interface SavePackageResult {
  canceled: boolean;
  filePath?: string;
  packageSha256?: string;
}

export interface SecureDocDesktopApi {
  savePackage(request: SavePackageRequest): Promise<SavePackageResult>;
  getHistory(): Promise<PublishHistoryRecord[]>;
  showItemInFolder(filePath: string): Promise<void>;
}

