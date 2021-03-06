import { validation, ValidationError } from "../src";

describe("eq test", () => {
    it("should not get triggered if an empty value was set", async () => {
        await expect(validation.validate(null, "eq")).resolves.toBe(true);
    });

    it("should fail - value not equal", async () => {
        await expect(validation.validate(12, "eq:123")).rejects.toThrow(ValidationError);
    });

    it("should fail - value not equal: 123", async () => {
        await expect(validation.validate("test", "eq:123")).rejects.toThrow(ValidationError);
    });

    it("should fail - value not equal: 105", async () => {
        await expect(validation.validate("text", "eq:105")).rejects.toThrow(ValidationError);
    });

    it("should fail - value not equal: obj 105", async () => {
        await expect(validation.validate({}, "eq:105")).rejects.toThrow(ValidationError);
    });

    it("should pass - strings are the same", async () => {
        await expect(validation.validate("test", "eq:test")).resolves.toBe(true);
        await expect(validation.validate("text", "eq:text")).resolves.toBe(true);
    });

    it("should pass - in spite of data types being different", async () => {
        await expect(validation.validate(11, "eq:11")).resolves.toBe(true);
        await expect(validation.validate(11.99, "eq:11.99")).resolves.toBe(true);
    });
});
