import { Request, Response } from 'express';
import path from 'path';
import { UploadedFile } from 'express-fileupload';

export const UPLOAD_DIR = path.join(__dirname, '../../../frontend/public/uploads/');
// export const UPLOAD_DIR = path.join(__dirname, '../static/uploads/');

const generateFileName = (originalName: string): string => {
    const fileExt = originalName.split('.').pop();
    return `file-${Date.now()}.${fileExt}`;
};

export const handleFileUpload = async (file: UploadedFile, directory: string): Promise<string> => {
    const fileName = generateFileName(file.name);
    const uploadPath = path.join(directory, fileName);
    await file.mv(uploadPath);
    return uploadPath;
};

export const uploadFile = async (req: Request, res: Response) => {
    try {
        if (!req.files || Object.keys(req.files).length === 0) {
            return res.status(400).json({ error: 'No files were uploaded' });
        }

        const uploadedFile = req.files.file as UploadedFile;
        
        const uploadPath = await handleFileUpload(uploadedFile, UPLOAD_DIR);
        const fileName = path.basename(uploadPath);

        res.status(201).json({
            filePath: `/uploads/${fileName}`,
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to upload file' });
    }
};

export const uploadMultiFile = async (req: Request, res: Response) => {
    try {
        if (!req.files || !Array.isArray(req.files.files)) {
            return res.status(400).json({ error: 'No files were uploaded' });
        }

        const fileNames: string[] = [];
        for (const file of req.files.files) {
            const uploadPath = await handleFileUpload(file, UPLOAD_DIR);
            const fileName = path.basename(uploadPath);
            fileNames.push(fileName);
        }

        res.status(201).json({
            fileNames: fileNames,
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to upload files' });
    }
};