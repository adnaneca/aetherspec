import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, FileText, Loader2, CheckCircle2 } from 'lucide-react';

interface UploadedFile {
  name: string;
  path: string;
  size: number;
}

interface DocumentUploadProps {
  projectId: string;
  onUploaded?: (file: UploadedFile) => void;
}

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_API_URL || 'https://api.aetherspec.ai';

export function DocumentUpload({ projectId, onUploaded }: DocumentUploadProps) {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);

    for (const file of Array.from(files)) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('projectId', projectId);
        formData.append('folder', 'input');

        const resp = await fetch(`${GATEWAY_URL}/api/attachment`, {
          method: 'POST',
          body: formData,
        });

        if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);

        const result = await resp.json();
        const uploaded: UploadedFile = {
          name: file.name,
          path: result.minioPath || result.path || `input/${file.name}`,
          size: file.size,
        };
        setUploadedFiles((prev) => [...prev, uploaded]);
        onUploaded?.(uploaded);
      } catch (err) {
        setError((err as Error).message);
      }
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="p-3 border-t border-border">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".md,.txt,.doc,.docx,.pdf"
        onChange={(e) => handleUpload(e.target.files)}
        className="hidden"
      />

      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border bg-background px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
      >
        {uploading ? (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            {t('studio.uploading')}
          </>
        ) : (
          <>
            <Upload className="size-3.5" />
            {t('studio.uploadDocs')}
          </>
        )}
      </button>

      {error && (
        <div className="mt-2 text-[10px] text-destructive font-mono">{error}</div>
      )}

      {uploadedFiles.length > 0 && (
        <div className="mt-2 space-y-1">
          {uploadedFiles.map((file, i) => (
            <div
              key={i}
              className="flex items-center gap-2 p-1.5 rounded bg-background border border-border text-[10px] font-mono"
            >
              <CheckCircle2 className="size-3 text-status-approved shrink-0" />
              <FileText className="size-3 text-muted-foreground shrink-0" />
              <span className="truncate text-foreground">{file.name}</span>
              <span className="text-muted-foreground ml-auto shrink-0">{formatSize(file.size)}</span>
            </div>
          ))}
        </div>
      )}

      <p className="mt-2 text-center font-mono text-[10px] text-muted-foreground">
        {t('studio.uploadsBucket', { bucket: projectId })}
      </p>
    </div>
  );
}
