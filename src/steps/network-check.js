"use strict";
/**
 * Network response status checker step handler for chromedev-director
 * Validates that no network responses have failed (4xx/5xx) status codes
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.networkCheckStep = networkCheckStep;
/**
 * Executes a network check step by validating network response statuses
 *
 * @param client - The CDP client used to retrieve network responses
 * @param step - The step definition containing the network_check flag
 * @param vars - Variables object (unused for network check operations)
 * @returns Promise resolving to success/failure with error details if applicable
 *
 * @example
 * // Check that all network responses are successful
 * await networkCheckStep(client, { network_check: true }, {})
 * // Returns: { success: true } if all responses have status < 400
 * // Returns: { success: false, error: "Network errors: 404 https://api.example.com/users; 500 https://api.example.com/data" }
 *
 * @example
 * // Skip network check
 * await networkCheckStep(client, { network_check: false }, {})
 * // Returns: { success: true }
 *
 * @example
 * // Invalid network_check value (not a boolean)
 * await networkCheckStep(client, { network_check: "true" }, {})
 * // Returns: { success: false, error: "network_check must be a boolean" }
 */
function networkCheckStep(client, step, vars) {
    return __awaiter(this, void 0, void 0, function () {
        var shouldCheck, responses, errors, errorText, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    shouldCheck = step.network_check;
                    // Validate that network_check is a boolean
                    if (typeof shouldCheck !== "boolean") {
                        return [2 /*return*/, {
                                success: false,
                                error: "network_check must be a boolean",
                            }];
                    }
                    // If network_check is false, skip the check
                    if (!shouldCheck) {
                        return [2 /*return*/, { success: true }];
                    }
                    return [4 /*yield*/, client.getNetworkResponses()];
                case 1:
                    responses = _a.sent();
                    errors = responses.filter(function (resp) { return resp.status >= 400; });
                    // If there are errors, return them as a formatted list
                    if (errors.length > 0) {
                        errorText = errors.map(function (e) { return "".concat(e.status, " ").concat(e.url); }).join("; ");
                        return [2 /*return*/, {
                                success: false,
                                error: "Network errors: ".concat(errorText),
                            }];
                    }
                    return [2 /*return*/, { success: true }];
                case 2:
                    error_1 = _a.sent();
                    return [2 /*return*/, {
                            success: false,
                            error: error_1 instanceof Error ? error_1.message : String(error_1),
                        }];
                case 3: return [2 /*return*/];
            }
        });
    });
}
