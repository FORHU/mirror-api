import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";

/**
 * Example AWS Lambda Handler
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  try {
    console.log("Event:", JSON.stringify(event, null, 2));

    // Parse the body if it exists
    const body = event.body ? JSON.parse(event.body) : null;

    // TODO: Add your custom Lambda logic here

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "Hello from Lambda!",
        input: body,
      }),
    };
  } catch (error) {
    console.error("Error executing lambda:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "Internal server error",
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
