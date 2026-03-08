import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {
  classifyUploadError,
  createJsonResponse,
  readJsonBody,
  uploadToFreeImage,
} from './server/freeimageProxy.js'

const uploadRoute = '/api/freeimage/upload'

const createUploadMiddleware = (freeImageApiKey) => {
  return async (req, res) => {
    if (req.method !== 'POST') {
      createJsonResponse(res, 405, { error: 'Method not allowed. Use POST.' })
      return
    }

    const apiKey = freeImageApiKey
    if (!apiKey) {
      createJsonResponse(res, 500, { error: 'FREEIMAGE_API_KEY is not configured.' })
      return
    }

    try {
      const body = await readJsonBody(req)
      const image = typeof body.image === 'string' ? body.image : ''
      if (!image) {
        createJsonResponse(res, 400, { error: 'Missing required "image" field.' })
        return
      }

      const url = await uploadToFreeImage({ imageInput: image, apiKey })
      createJsonResponse(res, 200, { url })
    } catch (error) {
      const statusCode = classifyUploadError(error)
      createJsonResponse(res, statusCode, { error: error?.message || 'Upload failed.' })
    }
  }
}

const freeImageUploadApiPlugin = (freeImageApiKey) => ({
  name: 'freeimage-upload-api',
  configureServer(server) {
    server.middlewares.use(uploadRoute, createUploadMiddleware(freeImageApiKey))
  },
  configurePreviewServer(server) {
    server.middlewares.use(uploadRoute, createUploadMiddleware(freeImageApiKey))
  },
})

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const freeImageApiKey = env.FREEIMAGE_API_KEY || process.env.FREEIMAGE_API_KEY

  return {
    plugins: [
      react(),
      tailwindcss(),
      freeImageUploadApiPlugin(freeImageApiKey),
    ],
  }
})
