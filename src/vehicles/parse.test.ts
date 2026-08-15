import test from "node:test";
import assert from "node:assert/strict";
import { parseVehicle, parseMileage, parsePriceCents } from "./parse.js";

test("parses a standard Marketplace car title", () => {
  const v = parseVehicle("2016 Toyota RAV4 XLE AWD");
  assert.equal(v.year, 2016);
  assert.equal(v.make, "Toyota");
  assert.equal(v.model, "RAV4");
  assert.equal(v.trim, "XLE");
});

test("prefers multi-word trims over their prefixes", () => {
  const v = parseVehicle("2021 Toyota 4Runner TRD Off-Road Premium");
  assert.equal(v.model, "4Runner");
  assert.equal(v.trim, "TRD Off-Road Premium");

  const pro = parseVehicle("2020 Toyota 4Runner TRD Pro");
  assert.equal(pro.trim, "TRD Pro");
});

test("handles spelling variants sellers actually use", () => {
  assert.equal(parseVehicle("2014 Toyota Rav 4 LE").model, "RAV4");
  assert.equal(parseVehicle("2018 toyota 4 runner sr5").model, "4Runner");
  assert.equal(parseVehicle("2019 Subaru Outback 2.5i Premium").trim, "Premium");
});

test("parses Subaru models and trims", () => {
  const outback = parseVehicle("2022 Subaru Outback Onyx Edition XT");
  assert.equal(outback.make, "Subaru");
  assert.equal(outback.model, "Outback");
  assert.equal(outback.trim, "Onyx Edition XT");

  const forester = parseVehicle("2023 Subaru Forester Wilderness");
  assert.equal(forester.model, "Forester");
  assert.equal(forester.trim, "Wilderness");
});

test("reads two-digit model years", () => {
  assert.equal(parseVehicle("'08 Subaru Forester X").year, 2008);
  assert.equal(parseVehicle("98 Toyota 4Runner SR5").year, 1998);
});

test("ignores years outside a plausible range", () => {
  assert.equal(parseVehicle("Toyota RAV4, asking 1200").year, null);
});

test("pulls mileage out of the description", () => {
  const v = parseVehicle(
    "2015 Subaru Outback Limited",
    "Great shape, 132,450 miles, new tires."
  );
  assert.equal(v.mileage, 132450);
});

test("parses mileage in its common written forms", () => {
  assert.equal(parseMileage("87,500 miles"), 87500);
  assert.equal(parseMileage("Mileage: 104000"), 104000);
  assert.equal(parseMileage("about 96k miles"), 96000);
  assert.equal(parseMileage("122k mi"), 122000);
  assert.equal(parseMileage("odometer 45,000"), 45000);
  assert.equal(parseMileage("no numbers here"), null);
});

test("takes the odometer, not an earlier service milestone", () => {
  assert.equal(
    parseMileage("Timing belt done at 90,000 miles. Now at 145,000 miles."),
    145000
  );
});

test("rejects implausible odometer readings", () => {
  assert.equal(parseMileage("9,999,999 miles"), null);
  assert.equal(parseMileage("0 miles"), null);
});

test("parses prices into cents", () => {
  assert.equal(parsePriceCents("$12,500"), 1250000);
  assert.equal(parsePriceCents("8995"), 899500);
  assert.equal(parsePriceCents("$1,299.99"), 129999);
  assert.equal(parsePriceCents("Free"), 0);
  assert.equal(parsePriceCents(""), null);
  assert.equal(parsePriceCents("N/A"), null);
});

test("records the make even when the model is unrecognized", () => {
  const v = parseVehicle("2017 Toyota Highlander Limited");
  assert.equal(v.make, "Toyota");
  assert.equal(v.model, null);
  assert.equal(v.trim, null);
});
