module.exports = {
    env: {
        browser: true,
        es6: true,
    },
    root: true,
    parser: "@typescript-eslint/parser",
    plugins: ["@typescript-eslint", "eslint-plugin-import", "eslint-plugin-prefer-arrow"],
    rules: {
        "@typescript-eslint/member-ordering": [
            "error",
            {"classes": [
                "static-field",
                "static-method",
                "public-instance-field",
                "protected-instance-field",
                "#private-instance-field",
                "constructor",
                "public-instance-method",
                "protected-instance-method",
                "#private-instance-method",
            ] },
        ],
        "@typescript-eslint/consistent-type-imports": "error",
        "@typescript-eslint/explicit-module-boundary-types": "off",
        "@typescript-eslint/no-explicit-any": "off",
        "import/order": "error",
        "max-classes-per-file": ["error", 1],
        "max-len": [
            "error",
            {
                code: 120,
            },
        ],
    },
};
