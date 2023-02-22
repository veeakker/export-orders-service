// import { query } from 'mu';emtech/mu-javascript-template for more info
import { app, query, errorHandler } from 'mu';

app.get('/', async function( req, res ) {
  try {
    // TODO: accept various ways of supplying delivery information
    const response = await query(`PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
     PREFIX veeakker: <http://veeakker.be/vocabularies/shop/>
     PREFIX gr: <http://purl.org/goodrelations/v1#>
     PREFIX adms: <http://www.w3.org/ns/adms#>
     PREFIX schema: <http://schema.org/>

     SELECT DISTINCT ?address ?aantalPakjes ?totalPrice ?pStuks AS ?besteldStuks ?pGrm AS ?besteldGram ?plu ?basket ?p ?o WHERE {
       GRAPH ?g {
         ?basket mu:uuid ?basketUuid.
         ?basket veeakker:basketOrderStatus <http://veeakker.be/order-statuses/confirmed>.
         ?basket veeakker:orderLine ?orderLine.
         ?basket veeakker:invoiceAddress ?address.
         ?orderLine veeakker:amount ?aantalPakjes.
         ?orderLine veeakker:hasOffering ?offering.
         ?offering gr:hasPriceSpecification ?priceSpecification.
         ?offering gr:includesObject ?typeAndQuantity.
         ?priceSpecification gr:hasCurrencyValue ?totalPrice.
         ?typeAndQuantity gr:typeOfGood ?product.
         ?product adms:identifier ?plu.
         OPTIONAL {
           ?typeAndQuantity
             gr:hasUnitOfMeasurement "KGM";
             gr:amountOfThisGood ?pKg.
           BIND ( ?pKg * 1000 AS ?pGrm )
         }
         OPTIONAL {
           ?typeAndQuantity
             gr:hasUnitOfMeasurement "C62";
             gr:amountOfThisGood ?pStuks.
         }
         OPTIONAL {
           ?typeAndQuantity
             gr:hasUnitOfMeasurement "GRM";
             gr:amountOfThisGood ?pGrm.
         }
       }
       ?basket ?p ?o.
       ?address schema:hasAddress ?postalAddress.
       ?postalAddress ?pp ?po.
     } ORDER BY ?basket
`);

    res.send(JSON.stringify(response));
  } catch (e) {
    console.log(e);
  }
} );

app.use(errorHandler);
