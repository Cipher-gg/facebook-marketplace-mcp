import { z } from "zod";
import type { FacebookClient } from "../facebook/client.js";
import {
  saveSearchListings,
  saveListingDetail,
  getListing as getStoredListing,
} from "../storage/listings.js";
import { parseVehicle } from "../vehicles/parse.js";

export const getListingSchema = {
  listing_id: z.string().describe("Facebook Marketplace listing ID"),
  save: z
    .boolean()
    .default(true)
    .describe(
      "Save the fetched details (mileage, trim, photos, seller, description) to the car database"
    ),
};

export function createListingHandler(client: FacebookClient) {
  return async (args: { listing_id: string; save: boolean }) => {
    try {
      const listing = await client.getListingDetail(args.listing_id);

      let saveNote: string | null = null;
      if (args.save) {
        try {
          // The listing may not have come from a monitor sweep — make sure a
          // row exists before folding the detail fields into it.
          if (!getStoredListing(listing.id)) {
            saveSearchListings([
              {
                id: listing.id,
                title: listing.title,
                price: listing.price,
                location: listing.location,
                imageUrl: listing.imageUrl,
                sellerName: listing.sellerName,
                postedDate: listing.postedDate,
                url: listing.url,
                isPending: listing.isPending,
              },
            ]);
          }
          saveListingDetail(listing);
          saveNote = "💾 Saved to car database.";
        } catch (error) {
          saveNote = `⚠️ Could not save to database: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      const vehicle = parseVehicle(listing.title, listing.description);
      const vehicleLine = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
        .filter(Boolean)
        .join(" ");

      const parts = [
        `# ${listing.title}`,
        "",
        vehicleLine ? `**Vehicle:** ${vehicleLine}` : null,
        vehicle.mileage !== null
          ? `**Mileage:** ${vehicle.mileage.toLocaleString("en-US")} mi`
          : "**Mileage:** not stated in listing",
        `**Price:** ${listing.price}`,
        listing.condition ? `**Condition:** ${listing.condition}` : null,
        `**Location:** ${listing.location}`,
        listing.isPending ? "**Status:** ⏳ Pending" : null,
        "",
        listing.description ? `## Description\n${listing.description}` : null,
        "",
        `**Seller:** ${listing.seller.name}`,
        listing.seller.profileUrl
          ? `**Profile:** ${listing.seller.profileUrl}`
          : null,
        "",
        listing.images.length > 0
          ? `**Images:** ${listing.images.length} photo(s)\n${listing.images.map((u, i) => `  ${i + 1}. ${u}`).join("\n")}`
          : null,
        "",
        `🔗 ${listing.url}`,
        saveNote,
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content: [{ type: "text" as const, text: parts }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error fetching listing: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  };
}
