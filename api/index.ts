import serverless from "serverless-http";
import app from "../src/server";

export default serverless(app);