import axios from "axios";
import { FASHN_API_KEY, FASHN_BASE_URL } from "../../config";
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
