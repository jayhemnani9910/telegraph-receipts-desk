// The serverless entry for the hosted demo. It pays from a separate demo wallet that holds only test USDC.
import { createApi } from "./api.ts";

export default createApi({ hosted: true });
