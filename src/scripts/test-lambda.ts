import { handler } from "../functions/example.lambda";
import { APIGatewayProxyEvent, Context } from "aws-lambda";

async function runTest() {
  console.log("🚀 Testing Lambda function locally...");

  // 1. Create a mock APIGatewayProxyEvent
  const mockEvent = {
    body: JSON.stringify({ testData: "Hello from local test!" }),
    headers: { "Content-Type": "application/json" },
    httpMethod: "POST",
    path: "/test-path",
    queryStringParameters: { foo: "bar" },
  } as unknown as APIGatewayProxyEvent;

  // 2. Create a mock Context
  const mockContext = {
    functionName: "exampleLambda",
    awsRequestId: "mock-request-id-12345",
  } as unknown as Context;

  // 3. Invoke the handler
  try {
    const result = await handler(mockEvent, mockContext);
    if (result.statusCode !== 200) {
      throw new Error("Lambda execution failed");
    }
    console.log("\n✅ Lambda executed successfully!");
    console.log("Result:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("\n❌ Lambda execution failed:", error);
  }
}

runTest();
