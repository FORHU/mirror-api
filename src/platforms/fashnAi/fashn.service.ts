import axios from "axios";
import { FASHN_API_KEY, FASHN_BASE_URL, FASHN_VIDEO_MODEL } from "../../config";
import logger from "../../utils/logger";

export interface FashnRunResponse {
  id: string;
  status: string;
}

export interface FashnStatusResponse {
  id: string;
  status: string;
  output?: string[];
  error?: string;
}

export default class FashnService {
  private static headers = {
    Authorization: `Bearer ${FASHN_API_KEY}`,
    "Content-Type": "application/json",
  };

  /**
   * Triggers a virtual try-on run
   */
  static async runTryOn(modelUrl: string, garmentUrl: string, category: string): Promise<FashnRunResponse> {
    try {
      logger.info(`Triggering FASHN.AI try-on for model: ${modelUrl}`);

      const response = await axios.post(
        `${FASHN_BASE_URL}/run`,
        {
          model_name: "tryon-v1.6",
          inputs: {
            model_image: modelUrl,
            garment_image: garmentUrl,
            category: category, // e.g. "tops", "bottoms", "one-pieces"
            nsfw_filter: true,
            cover_feet: false,
            adjust_hands: true,
            restore_face: true,
          },
        },
        { headers: this.headers }
      );

      return response.data;
    } catch (error: any) {
      const status = error.response?.status;
      const data = error.response?.data;
      logger.error(`FASHN.AI Run Error [${status}]:`, data || error.message);
      throw { status: status || 500, message: data?.message || "FASHN.AI request failed" };
    }
  }

  /**
   * Triggers a video try-on run.
   *
   * Notes:
   *   - `model_name` comes from FASHN_VIDEO_MODEL env var. The image flow
   *     hardcodes "tryon-v1.6"; FASHN's video product is a different model id.
   *   - The `inputs` shape below mirrors the image schema. If FASHN's video
   *     model expects different field names (e.g. `model_video`, extra
   *     duration/fps params), adjust here once the model id is confirmed.
   */
  static async runVideoTryOn(modelUrl: string, garmentUrl: string, category: string): Promise<FashnRunResponse> {
    if (!FASHN_VIDEO_MODEL) {
      throw { status: 503, message: "FASHN_VIDEO_MODEL not configured" };
    }

    try {
      logger.info(`Triggering FASHN.AI video try-on for model: ${modelUrl}`);

      const response = await axios.post(
        `${FASHN_BASE_URL}/run`,
        {
          model_name: FASHN_VIDEO_MODEL,
          inputs: {
            model_image: modelUrl,
            garment_image: garmentUrl,
            category,
            nsfw_filter: true,
            restore_face: true,
          },
        },
        { headers: this.headers }
      );

      return response.data;
    } catch (error: any) {
      const status = error.response?.status;
      const data = error.response?.data;
      logger.error(`FASHN.AI Video Run Error [${status}]:`, data || error.message);
      throw { status: status || 500, message: data?.message || "FASHN.AI video request failed" };
    }
  }

  /**
   * Checks the status of a specific job
   */
  static async getStatus(id: string): Promise<FashnStatusResponse> {
    try {
      const response = await axios.get(`${FASHN_BASE_URL}/status/${id}`, {
        headers: this.headers,
      });
      return response.data;
    } catch (error: any) {
      logger.error(`FASHN.AI Status Error:`, error.response?.data || error.message);
      throw { status: error.response?.status || 500, message: "Failed to fetch FASHN.AI status" };
    }
  }
}
