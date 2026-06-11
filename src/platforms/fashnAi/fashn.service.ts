import axios from "axios";
import { FASHN_API_KEY, FASHN_BASE_URL, FASHN_VIDEO_MODEL, FASHN_MODEL } from "../../config";
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
  static async runTryOn(
    modelUrl: string,
    garmentUrl: string,
    category: string,
    prompt?: string
  ): Promise<FashnRunResponse> {
    try {
      logger.info(`Triggering FASHN.AI try-on for model: ${modelUrl}`);

      const isMaxModel = FASHN_MODEL.includes("max");
      const inputs = isMaxModel
        ? {
            model_image: modelUrl,
            product_image: garmentUrl, // tryon-max uses product_image instead of garment_image
            ...(prompt && { prompt }),
          }
        : {
            model_image: modelUrl,
            garment_image: garmentUrl,
            category: category, // e.g. "tops", "bottoms", "one-pieces"
            ...(prompt && { prompt }),
          };

      const response = await axios.post(
        `${FASHN_BASE_URL}/run`,
        {
          model_name: FASHN_MODEL,
          inputs,
        },
        { headers: this.headers }
      );

      return response.data;
    } catch (error) {
      const err = error as {
        response?: { data?: { message?: string }; status?: number };
        message: string;
      };
      const status = err.response?.status;
      const data = err.response?.data;
      logger.error(`FASHN.AI Run Error [${status}]:`, data || err.message);
      throw { status: status || 500, message: data?.message || "FASHN.AI request failed" };
    }
  }

  /**
   * Triggers a video try-on run.
   *
   * Notes:
   *   - `model_name` comes from FASHN_VIDEO_MODEL env var. The image flow
   *     uses FASHN_MODEL (defaults to "tryon-max"); FASHN's video product is a different model id.
   *   - The `inputs` shape below mirrors the image schema. If FASHN's video
   *     model expects different field names (e.g. `model_video`, extra
   *     duration/fps params), adjust here once the model id is confirmed.
   */
  static async runVideoTryOn(
    modelUrl: string,
    garmentUrl: string,
    category: string,
    prompt?: string
  ): Promise<FashnRunResponse> {
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
            ...(prompt && { prompt }),
          },
        },
        { headers: this.headers }
      );

      return response.data;
    } catch (error) {
      const err = error as {
        response?: { data?: { message?: string }; status?: number };
        message: string;
      };
      const status = err.response?.status;
      const data = err.response?.data;
      logger.error(`FASHN.AI Video Run Error [${status}]:`, data || err.message);
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
    } catch (error) {
      const err = error as { response?: { data?: unknown; status?: number }; message: string };
      logger.error(`FASHN.AI Status Error:`, err.response?.data || err.message);
      throw { status: err.response?.status || 500, message: "Failed to fetch FASHN.AI status" };
    }
  }
}
