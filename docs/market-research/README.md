# Market research: Vietnam (2026-11-17)

Desk research on who might pay for h3x.js / h3xEditor in Vietnam and what competitors charge. It is
based on public web pages (vendor pages, resellers, review articles). Many prices come from resellers
or marketing posts, disagree between sources, or may be outdated; only House3D's and Floorplanner's
(older brochure) prices are from the vendors themselves. Treat every number as a hypothesis to verify
with real customers.

## TL;DR

- Selling the **library** alone (h3x.js) is hard to monetize. Money is in **businesses embedding the
  editor in their sales process**, not in individual homeowners.
- The Vietnamese market splits into three competitor groups (consumer planners, interior / furniture
  design software, cost-estimation software). There is a **gap between them**: townhouse ("nhà phố",
  "nhà ống") design-and-build contractors.
- Their current online "cost calculators" only multiply floor area by a unit price. Nobody offers
  "draw the floor plan → see it in 3D → get a quantity-based estimate → send the lead to the
  contractor", embedded on the contractor's website. This matches what h3x.js is building
  (structure, floors, stairs, roof, XML data).
- Recommendation: target townhouse contractors; avoid the interior / CNC segment; consider a
  **"quantities and cost estimate"** milestone right after M7 (roof), possibly before M8 (furniture).

## 1. Consumer home planners: saturated, mostly free

| Product       | Price                                                           |
| ------------- | --------------------------------------------------------------- |
| Planner 5D    | Free tier; Premium $59.99/year ($19.99/month); Pro $399.99/year |
| Homestyler    | Free tier; Pro+ from ~$6.80/month, Master+ ~$11.80/month        |
| Floorplanner  | ~$4–29/month or credit packs (sources disagree)                 |
| Sweet Home 3D | Free (desktop; optional ~$15 app)                               |
| Roomstyler    | Free                                                            |
| SketchUp      | ~$119–399/year (sources disagree)                               |

Homeowners use these once or twice and have good free options. Competing head-on here is fighting
the incumbents where they are strongest.

## 2. Interior / furniture design software: crowded, well funded, customers do pay

| Product                                      | Price in Vietnam                                                                                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AiHouse (Chinese; distributed by ALOTHAU.VN) | 2M VND/month, 5M/3 months, 8M/6 months, **15M VND/year per account**; extra accounts 12M VND/year                                                                       |
| House3D (Vietnamese startup, Hanoi)          | Basic app free; paid **per module, 125,000–200,000 VND/account/month** (tiles, ceilings/walls, kitchen and wardrobe cabinets, personal library); enterprise by contract |
| Coohom (Chinese)                             | ~$29/month Pro (2026 review); another source says $49–99/month                                                                                                          |

Notes:

- House3D also exports construction quotes and 2D CAD drawings right after the design, has a 3D
  marketplace, and runs a build arm ("Nội Thất Một Giờ") that executes users' designs.
- Proof point: Vietnamese businesses already pay **~15M VND/year per account** for 3D design
  software with quoting. But the interior segment (kitchen cabinets, CNC, photoreal renders) has
  strong incumbents.

## 3. Construction cost-estimation software: cheap, one-off, for formal paperwork

| Product | Price                                                               |
| ------- | ------------------------------------------------------------------- |
| G8      | Express free; 1–4M VND; Settlement edition 7M VND                   |
| Eta     | Professional 4M, Ultimate 6M VND; online ~1M VND/year; student 999k |
| Delta   | Free trial; 2–4M VND                                                |

These follow the official state norms ("định mức") with manual line-item entry. No visuals, so they
do not help a contractor close a client.

## 4. The gap: townhouse design-and-build contractors

Almost every Vietnamese "xây nhà trọn gói" company has an online cost calculator to capture leads.
They are crude:

- Input: land area, floors, foundation / roof type, sometimes mezzanine / basement / roof deck.
- Output: area × unit price (roughly **5–7.5M VND/m²** depending on package and region), then
  "get a detailed quote on Zalo".
- No drawing, no 3D, no real quantities. Several sites say themselves the result is only indicative.

Missing product: an embeddable editor where the visitor draws a townhouse floor plan, sees it in 3D,
gets an estimate from real quantities (wall, floor, roof areas, openings, stairs), and the result
arrives at the contractor as a qualified lead.

## 5. Embedding / white-label references abroad

- **Floorplanner Enterprise**: white-label API to embed Floorplanner on a retailer's site; unlimited
  users, custom Roomplanner, SSO. An older, undated brochure lists €249–1,999/month
  (€2,499–19,999/year); an aggregator lists ~$599/month; a review says enterprise pricing is
  negotiated.
- **Planner 5D** sells an interior design API for business integrations.

So the "embed the editor on a business website" model already has paying customers abroad.

## 6. Who might pay (ranked)

1. **Townhouse design-and-build contractors** (best fit): quick floor plan + 3D with the client +
   automatic quantities and estimate. The XML model already holds the data for quantity take-off, so
   this is cheap to build but directly valuable.
2. **Real-estate developers / brokers**: embed apartment / townhouse plans on sales pages so buyers
   view 3D and try layouts; pay per project or white-label license.
3. **Furniture and building-material brands** (tiles, paint, furniture): the editor as lead
   generation, placing their real products in the buyer's home (needs M8: catalog, GLB).
4. **Architects / small studios**: per-seat subscription, but they already use SketchUp / Revit.

Unlikely payers: individual homeowners (free alternatives), developers buying a library (small market,
open source is hard to charge for unless dual-licensed).

## 7. Business model fit with the h3x.js / h3xEditor split

- **Open core**: h3x.js open source (MIT) for credibility and community.
- **Commercial license for h3xEditor** for businesses that embed it (per domain or per project).
- Later **SaaS** for contractors: project storage, share links with clients, PDF quote export.

## 8. Pricing hypotheses for Vietnam (to validate)

- Contractor internal use (quick drafting with clients): **~300,000–800,000 VND/account/month**,
  between House3D modules and AiHouse.
- Embed license on a contractor's / developer's website, with leads and estimates:
  **~10–30M VND/year per company**, far below Floorplanner, about the cost of one AiHouse seat.

## 9. Differentiators to lean on

- Vietnam-specific: townhouse templates, lot boundary and setbacks per local rules, stairs sized by
  2h + b ≈ 60–64 cm, multi-floor townhouses with roof deck.
- Embeddable, realtime XML document: easier to integrate with a business's own systems (CRM, quoting)
  than a closed app.

## 10. Next steps

- Talk to 5–10 townhouse contractors / design-build firms before investing in M8–M9: would they pay for
  "quick drawing + 3D + quantity-based estimate + embeddable lead capture", and how much?
- If yes, add a **"Quantities and cost estimate"** milestone after M7 and lower M8's priority.

## Sources

- [Planner 5D Pricing 2026 – renderahouse](https://www.renderahouse.com/blog/planner-5d-pricing)
- [Planner 5D Pricing 2026 – formas.ai](https://www.formas.ai/articles/planner-5d-pricing)
- [Homestyler Pricing 2026 – checkthat.ai](https://checkthat.ai/brands/homestyler/pricing)
- [Floorplanner vs Planner 5D vs Homestyler – spotsaas](https://www.spotsaas.com/compare/floorplanner-vs-planner-5d-vs-homestyler)
- [TOP 9 web thiết kế nhà miễn phí – viettelstore](https://viettelstore.vn/tin-tuc/web-thiet-ke-nha)
- [Top 15 phần mềm thiết kế nhà 3D – vinnotek](https://vinnotek.com/phan-mem-thiet-ke-nha-3d/)
- [Phần mềm AiHouse – sgmedia.vn](https://sgmedia.vn/dich-vu/phan-mem-aihouse-1530.html)
- [AiHouse – pricing](https://www.aihouse.com/vi/product/pricing)
- [House3D – pricing](https://vi.house3d.com/pricing)
- [House3D – Ashui Awards](https://ashui.com/awards/house3d/)
- [Nội Thất Một Giờ – Đổi mới sáng tạo TP.HCM](https://doimoisangtao.vn/ecosystem/ni-tht-mt-gi)
- [Coohom review 2026 – genroom](https://genroom.io/vi/blog/coohom-review-best-alternatives)
- [Dự toán G8 Enterprise 2026 – Hoàng Hà](https://phanmemg8hoangha.com/san-pham/du-toan-g8-enterprise/)
- [Mua Dự Toán G8 bản quyền](https://dutoang8hoangha.com/mua-du-toan-g8-ban-quyen/)
- [Phần mềm dự toán Eta bản quyền](https://phanmemeta.com/phan-mem-du-toan-eta-ban-quyen.html)
- [Top phần mềm dự toán – timviec365](https://timviec365.vn/blog/phan-mem-du-toan-new12527.html)
- [Floorplanner Enterprise](https://floorplanner.com/enterprise)
- [Floorplanner enterprise brochure](http://cdn.floorplanner.com/static/brochures/FP-enterprise-brochure-en.pdf)
- [Floorplanner pricing – SaaSworthy](https://www.saasworthy.com/product/floorplanner/pricing)
- [Planner 5D Business API](https://planner5d.com/business/api-integrations)
- [Dự toán xây nhà trọn gói – Trường Sinh](https://xaydungtruongsinh.com.vn/du-toan-xay-nha.html)
- [Tính chi phí xây nhà – Cường Thịnh Phát](https://cuongthinhphatvn.com/khai-toan)
- [Báo giá thiết kế & thi công – Không Gian Việt](https://khong-gian-viet.com/bao-gia-xay-dung/)
- [Báo giá xây nhà trọn gói – Decox](https://decoxdesign.com/bao-gia-xay-nha-tron-goi)
- [Báo giá xây nhà online – Nhật Lam](https://kientrucnhatlam.com/bao-gia-xay-nha-online/)
