import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress"; // Import Progress component
import { UploadCloudIcon, FileIcon, XIcon, CheckCircleIcon, XCircleIcon } from 'lucide-react'; // Using lucide-react icons
import { toast } from "sonner";
import api from '@/services/api';

interface FileUploadProps {
  targetHostIds: number[] | 'all';
  onUploadComplete: () => void; // Callback when upload finishes
  onClose: () => void; // Callback to close the dialog
}

// 新增上传结果接口
interface UploadResult {
  success: boolean;
  message: string;
  details?: {
    succeeded: string[];
    failed: Record<string, string>;
  };
}

function FileUpload({ targetHostIds, onUploadComplete, onClose }: FileUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [remotePath, setRemotePath] = useState('/tmp/'); // Default remote path
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0]);
      setUploadProgress(0); // Reset progress when a new file is selected
      setUploadResult(null); // Reset previous results
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false, // Allow only single file upload
  });

  const handleUpload = async () => {
    if (!file) {
      toast.error("mistake", { description: "Please select a file first" });
      return;
    }
    if (!remotePath.trim()) {
      toast.error("mistake", { description: "Please enter the target path on the remote server" });
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setUploadResult(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('remote_path', remotePath.trim());
    formData.append('hosts', JSON.stringify(targetHostIds)); // Send hosts as JSON string

    try {
      const response = await api.post<UploadResult>("/api/upload", formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / (progressEvent.total || 1));
          setUploadProgress(percentCompleted);
        },
      });

      // 保存上传结果
      setUploadResult(response.data);
      
      // 根据返回结果显示不同的消息
      if (response.data.success) {
        const details = response.data.details;
        const succeededCount = details?.succeeded.length || 0;
        const failedCount = Object.keys(details?.failed || {}).length;
        
        if (failedCount === 0) {
          // 全部成功
          toast.success("File upload successfully", { 
            description: `The file has been successfully uploaded to all target hosts ${remotePath}` 
          });
        } else {
          // 部分成功
          toast.warning("File part upload successfully", { 
            description: `success: ${succeededCount}Taiwan, failed:${failedCount}. See details for more information.` 
          });
        }
        
        // 不自动关闭对话框，让用户查看结果
        onUploadComplete(); // 仅通知父组件上传完成
      } else {
        // 全部失败时的显示
        toast.error("File upload failed", {
          description: response.data.message || "All hosts failed to upload",
        });
      }
    } catch (error) {
      console.error('File upload failed:', error);
      const errorMsg = error instanceof Error 
        ? error.message 
        : ((error as any).response?.data?.message || (error as any).response?.data?.error || "发生未知错误");
      
      toast.error("File upload failed", {
        description: errorMsg,
      });
    } finally {
      setIsUploading(false);
    }
  };

  const removeFile = () => {
    setFile(null);
    setUploadProgress(0);
    setUploadResult(null);
  };

  return (
    <div className="space-y-4">
      <div 
        {...getRootProps()} 
        className={`border-2 border-dashed rounded-md p-6 text-center cursor-pointer ${isDragActive ? 'border-primary bg-primary/10' : 'border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600'}`}
      >
        <input {...getInputProps()} />
        <UploadCloudIcon className="mx-auto h-12 w-12 text-gray-400" />
        {isDragActive ? (
          <p className="mt-2 text-sm text-primary">Drag the file here...</p>
        ) : (
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Drag and drop the file here, or click Select File</p>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-500">Only single file uploads are supported</p>
      </div>

      {file && (
        <div className="border rounded-md p-3 flex items-center justify-between bg-muted/50">
          <div className="flex items-center gap-2">
            <FileIcon className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium truncate max-w-[200px]" title={file.name}>{file.name}</span>
            <span className="text-xs text-muted-foreground">({(file.size / 1024).toFixed(2)} KB)</span>
          </div>
          <Button variant="ghost" size="icon" onClick={removeFile} disabled={isUploading}>
            <XIcon className="h-4 w-4" />
          </Button>
        </div>
      )}

      {isUploading && (
        <Progress value={uploadProgress} className="w-full" />
      )}

      <div className="grid gap-2">
        <Label htmlFor="remotePath">Remote path</Label>
        <Input 
          id="remotePath" 
          placeholder="For example: /tmp/ or/home/user/" 
          value={remotePath}
          onChange={(e) => setRemotePath(e.target.value)}
          disabled={isUploading}
        />
        <p className="text-xs text-muted-foreground">The file will be uploaded to this directory on the target host.</p>
      </div>

      {uploadResult && (
        <div className="border rounded-md p-3 bg-muted/90">
          <h4 className="text-sm font-medium mb-2">Upload results</h4>
          <p className="text-sm mb-2">{uploadResult.message}</p>
          
          {uploadResult.details && (
            <div className="text-xs space-y-1 max-h-40 overflow-y-auto">
              {uploadResult.details.succeeded.length > 0 && (
                <div>
                  <p className="font-medium text-green-600 dark:text-green-400 flex items-center gap-1">
                    <CheckCircleIcon className="h-3 w-3" />
                   success ({uploadResult.details.succeeded.length})
                  </p>
                  <ul className="pl-5 list-disc">
                    {uploadResult.details.succeeded.map(hostId => (
                      <li key={`success-${hostId}`}>Host ID: {hostId}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              {Object.keys(uploadResult.details.failed).length > 0 && (
                <div>
                  <p className="font-medium text-red-600 dark:text-red-400 flex items-center gap-1 mt-2">
                    <XCircleIcon className="h-3 w-3" />
                    fail ({Object.keys(uploadResult.details.failed).length})
                  </p>
                  <ul className="pl-5">
                    {Object.entries(uploadResult.details.failed).map(([hostId, errorMsg]) => (
                      <li key={`fail-${hostId}`} className="mb-1">
                        <span className="font-medium">Host ID: {hostId}</span>
                        <p className="text-red-500 dark:text-red-400">{errorMsg}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
         <Button variant="outline" onClick={onClose} disabled={isUploading}>
           {uploadResult ? 'Close' : 'Cancel'}
         </Button>
         {!uploadResult && (
           <Button onClick={handleUpload} disabled={!file || isUploading || !remotePath.trim()}>
             {isUploading ? 'Uploading... )' : 'Start uploading'}
           </Button>
         )}
         {uploadResult && uploadResult.success && (
           <Button variant="default" onClick={onClose}>
             Finish
           </Button>
         )}
      </div>
    </div>
  );
}

export default FileUpload;

