const cloudinary = require("cloudinary").v2;

// Configure Cloudinary from environment variables
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "veritask",
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
});

/**
 * Upload a file buffer directly to Cloudinary without saving to disk.
 * Supports images, videos, raw documents (PDF, DOCX, XLSX, ZIP, CSV, etc.)
 */
const uploadToCloudinary = (buffer, fileName, mimeType) => {
    return new Promise((resolve, reject) => {
        let resourceType = "auto";
        if (mimeType && mimeType.startsWith("image/")) {
            resourceType = "image";
        } else if (mimeType && mimeType.startsWith("video/")) {
            resourceType = "video";
        } else {
            resourceType = "raw"; // For PDF, ZIP, DOCX, etc.
        }

        const cleanFileName = (fileName || "deliverable").replace(/[^a-zA-Z0-9.-]/g, "_");
        const publicId = `${Date.now()}_${cleanFileName}`;

        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: "veritask_deliverables",
                resource_type: resourceType,
                public_id: publicId,
            },
            (error, result) => {
                if (error) {
                    console.error("Cloudinary upload stream error:", error);
                    return reject(error);
                }
                resolve(result);
            }
        );

        uploadStream.end(buffer);
    });
};

module.exports = {
    cloudinary,
    uploadToCloudinary,
};
