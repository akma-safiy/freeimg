const IMGBB_API_KEY = process.env.FREEIMAGE_API_KEY;
const API_URL = 'https://api.imgbb.com/1/upload';

// A tiny valid 1x1 transparent PNG base64 string
const base64Image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==';

async function testUpload() {
    try {
        if (!IMGBB_API_KEY) {
            throw new Error('FREEIMAGE_API_KEY is not set in your environment.');
        }

        const formData = new URLSearchParams();
        formData.append('key', IMGBB_API_KEY);
        formData.append('image', base64Image);

        console.log("Sending request to ImgBB...");
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData.toString()
        });

        const data = await response.json();
        console.log("Status:", response.status);
        console.log("Response:", data);
    } catch (e) {
        console.error("Error:", e);
    }
}

testUpload();
