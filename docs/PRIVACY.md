# Privacy Policy

_Last updated: 7 November 2026 (community price history added)_

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

All of this is stored in your browser (`chrome.storage.local`).

## Community price history (only if you turn it on)

The extension asks before sharing anything. Only if you choose "Yes" (or
switch it on in Options), it sends, for shop product pages you view: the
product id and page address, title, image address, price, MRP and time, with
a random id created for this purpose. It also downloads the shared history of
the product you are viewing, which tells the website which product that is.

On the website the random id and your IP address are stored only as salted
hashes (the IP only in a daily counter used against abuse). Your name,
account, orders and other browsing are never sent. The data is used only to
show price history to everyone, and is not sold.

Switching it off stops sharing and deletes the random id, the upload queue
and the downloaded history from your browser. Reports already sent stay in
the shared history without anything that identifies you.

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
