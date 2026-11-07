# Privacy Policy

_Last updated: 7 November 2026_

This policy covers the browser extension published from this repository
(working name "DaamDekho").

## What the extension reads

On product pages of **www.amazon.in, www.flipkart.com and www.myntra.com**,
the extension reads the product's title, price, MRP, image address and stock
status. It does not read pages on any other website, and it does not read
your account details, addresses, payment details or orders.

## What it stores, and where

- Price observations (product id, product page address, price, time).
- Products you choose to track, with any target price you set.
- Your settings.

All of this is stored **only in your browser** (`chrome.storage.local`). It is
not sent to the developer or to any third party.

## Network requests

For products you track, the extension periodically downloads that product's
page from the shop's website to check the current price. These requests go
directly from your browser to the shop and are sent without your cookies.

## Affiliate links

If affiliate links are enabled, opening a Flipkart or Myntra deal from a
price-drop alert or the deal list may go through an affiliate network link.
The shop and the network then see that visit as they would for any affiliate
link. Amazon links never use affiliate links in this extension.

## Your control

Options → **Export as JSON** downloads all stored data. **Delete all data**
erases it. Removing the extension also removes its data.

## Contact

Open an issue in this repository.
